import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import { formatQty, parseQty, qtyFromDb } from '../../../common/utils/quantity';
import { SkuService } from '../../product/services/sku.service';
import { SkuNotFoundError } from '../../product/errors/sku-errors';
import { ReservationNotFoundError } from '../errors/inventory.errors';
import {
  InventoryBalanceRepository,
  listBalancesWithRefs,
  BalanceListFilters,
} from '../repositories/inventory-balance.repository';
import {
  InventoryReservationRepository,
  ReservationListFilters,
} from '../repositories/inventory-reservation.repository';
import { InventorySerialRepository } from '../repositories/inventory-serial.repository';
import {
  InventoryTransactionRepository,
  TransactionListFilters,
} from '../repositories/inventory-transaction.repository';
import { ReservationDto, ReservationService } from './reservation.service';
import { ReplenishmentRepository } from '../repositories/replenishment.repository';
import { InventoryCondition } from '../enums/inventory.constants';
import { InventorySerialEntity } from '../entities/inventory-serial.entity';

/**
 * Only SELLABLE stock may be promised to a customer (inventory.md §5:
 * "不可销售 Condition 的库存不参与 SELLABLE Available"). Reservation already
 * hard-codes SELLABLE, so every availability figure shown to the user must
 * apply the same rule - otherwise the UI offers stock the order flow refuses.
 */
function isSellableCondition(condition: string): boolean {
  return condition === 'SELLABLE';
}

/** SELLABLE Available = sellable on-hand - safety, floored at zero. */
function sellableOf(sellableOnHand: bigint, safety: bigint): bigint {
  const net = sellableOnHand - safety;
  return net > 0n ? net : 0n;
}

export interface InventoryRowDto {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  binId: string;
  binCode: string;
  condition: InventoryCondition;
  onHandQty: string;
  reservedQty: string;
  pickedQty: string;
  /** On Hand - Reserved - Picked (task §10). */
  physicalAvailableQty: string;
  safetyQty: string;
  /** max(Physical Available - Safety, 0) (task §12). */
  sellableAvailableQty: string;
  status: 'IN_STOCK' | 'OUT_OF_STOCK';
}

export interface SkuInventoryWarehouseDto {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  onHandQty: string;
  reservedQty: string;
  pickedQty: string;
  physicalAvailableQty: string;
  safetyQty: string;
  sellableAvailableQty: string;
}

export interface SkuInventoryDetailDto {
  skuId: string;
  skuCode: string;
  skuName: string;
  totals: Omit<SkuInventoryWarehouseDto, 'warehouseId' | 'warehouseCode' | 'warehouseName'>;
  warehouses: SkuInventoryWarehouseDto[];
  bins: InventoryRowDto[];
}

export interface TransactionDto {
  id: string;
  transactionNo: string;
  eventNo: string;
  eventType: string;
  transactionType: string;
  skuId: string;
  skuCode: string;
  warehouseId: string;
  warehouseCode: string;
  binId: string;
  binCode: string;
  quantityBefore: string;
  quantityChange: string;
  quantityAfter: string;
  reservedBefore: string | null;
  reservedChange: string | null;
  reservedAfter: string | null;
  pickedBefore: string | null;
  pickedChange: string | null;
  pickedAfter: string | null;
  referenceType: string;
  referenceId: string;
  operatorId: string | null;
  operatorName: string | null;
  remark: string | null;
  createdAt: Date;
}

export interface ReservationListItemDto {
  id: string;
  reservationNo: string;
  skuId: string;
  skuCode: string;
  warehouseId: string;
  warehouseCode: string;
  referenceType: string;
  referenceId: string;
  requestedQty: string;
  status: string;
  remark: string | null;
  createdAt: Date;
  pickedAt: Date | null;
  releasedAt: Date | null;
  consumedAt: Date | null;
}

/**
 * Inventory read model (task §41-§44): balances with derived availability,
 * per-SKU drilldown, transaction ledger and reservation lists. Read-only -
 * queries never create balance rows as a side effect (task §70).
 */
@Injectable()
export class InventoryQueryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly balanceRepo: InventoryBalanceRepository,
    private readonly reservationRepo: InventoryReservationRepository,
    private readonly ledgerRepo: InventoryTransactionRepository,
    private readonly serialRepo: InventorySerialRepository,
    private readonly reservationService: ReservationService,
    private readonly skuService: SkuService,
    private readonly replenishmentRepo: ReplenishmentRepository,
  ) {}

  /**
   * Total on-hand of a SKU across warehouses and conditions, read on the
   * CALLER's transaction (Sprint 7 moving-average input, decision 0013
   * par6). Sees the receive lines the same transaction just wrote.
   */
  async getTotalOnHandInTx(runner: QueryRunner, skuId: string): Promise<string> {
    const rows = (await runner.query(
      `SELECT COALESCE(SUM(on_hand_qty), 0)::text AS total FROM inventory_balances WHERE sku_id = $1`,
      [skuId],
    )) as Array<{ total: string }>;
    return rows[0]?.total ?? '0';
  }

  /**
   * The bin where this SKU currently sits the most in a warehouse (决策 0021):
   * receiving defaults a line to that bin so same SKUs co-locate. Only
   * SELLABLE stock is considered (non-sellable stock must not attract
   * new arrivals); the largest on-hand wins, ties broken by bin_code so the
   * choice is deterministic. Returns null when the SKU has no stock yet.
   */
  async findCurrentBinId(skuId: string, warehouseId: string): Promise<string | null> {
    const rows = await this.dataSource.query<Array<{ bin_id: string }>>(
      `SELECT b.bin_id
         FROM inventory_balances b
         JOIN warehouse_bins bin ON bin.id = b.bin_id
        WHERE b.sku_id = $1 AND b.warehouse_id = $2
          AND b.inventory_condition = 'SELLABLE' AND b.on_hand_qty > 0
        ORDER BY b.on_hand_qty DESC, bin.bin_code ASC
        LIMIT 1`,
      [skuId, warehouseId],
    );
    return rows[0]?.bin_id ?? null;
  }

  async listBalances(
    filters: BalanceListFilters,
    page: { page: number; pageSize: number },
  ): Promise<{ items: InventoryRowDto[]; meta: PageMeta }> {
    const { rows, total } = await listBalancesWithRefs(
      this.dataSource,
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    return {
      items: rows.map((row) => this.toRowDto(row)),
      meta: { page: page.page, pageSize: page.pageSize, total },
    };
  }

  async getSkuInventory(skuId: string): Promise<SkuInventoryDetailDto> {
    const sku = await this.skuService.getEntityById(skuId);
    if (sku === null) {
      throw new SkuNotFoundError(skuId);
    }
    // 详情分布保留全零行：移位/调整需要看到每个库位的完整事实（含已清零）。
    const { rows } = await listBalancesWithRefs(
      this.dataSource,
      { skuId, includeEmpty: true },
      1000,
      0,
    );
    const bins = rows.map((row) => this.toRowDto(row));

    const warehouseMap = new Map<string, SkuInventoryWarehouseDto>();
    // SELLABLE on-hand per warehouse, tracked separately so a warehouse
    // holding both sellable and non-sellable stock cannot leak the latter
    // into SELLABLE Available (inventory.md §5).
    const sellableOnHandMap = new Map<string, bigint>();
    for (const row of rows) {
      const sellableOnHand = isSellableCondition(row.balance.inventoryCondition)
        ? qtyFromDb(row.balance.onHandQty)
        : 0n;
      const millistream = {
        onHand: qtyFromDb(row.balance.onHandQty),
        reserved: qtyFromDb(row.balance.reservedQty),
        picked: qtyFromDb(row.balance.pickedQty),
        safety: row.safetyQty === null ? 0n : parseQty(row.safetyQty),
        sellableOnHand,
      };
      const existing = warehouseMap.get(row.balance.warehouseId);
      if (existing === undefined) {
        const physical = millistream.onHand - millistream.reserved - millistream.picked;
        warehouseMap.set(row.balance.warehouseId, {
          warehouseId: row.balance.warehouseId,
          warehouseCode: row.warehouseCode,
          warehouseName: row.warehouseName,
          onHandQty: formatQty(millistream.onHand),
          reservedQty: formatQty(millistream.reserved),
          pickedQty: formatQty(millistream.picked),
          physicalAvailableQty: formatQty(physical),
          safetyQty: formatQty(millistream.safety),
          sellableAvailableQty: formatQty(
            sellableOf(millistream.sellableOnHand, millistream.safety),
          ),
        });
        sellableOnHandMap.set(row.balance.warehouseId, millistream.sellableOnHand);
      } else {
        const onHand = parseQty(existing.onHandQty) + millistream.onHand;
        const reserved = parseQty(existing.reservedQty) + millistream.reserved;
        const picked = parseQty(existing.pickedQty) + millistream.picked;
        const safety = parseQty(existing.safetyQty) + millistream.safety;
        const physical = onHand - reserved - picked;
        const sellableOnHand =
          (sellableOnHandMap.get(row.balance.warehouseId) ?? 0n) + millistream.sellableOnHand;
        sellableOnHandMap.set(row.balance.warehouseId, sellableOnHand);
        existing.onHandQty = formatQty(onHand);
        existing.reservedQty = formatQty(reserved);
        existing.pickedQty = formatQty(picked);
        existing.physicalAvailableQty = formatQty(physical);
        existing.safetyQty = formatQty(safety);
        existing.sellableAvailableQty = formatQty(sellableOf(sellableOnHand, safety));
      }
    }

    const warehouses = [...warehouseMap.values()];
    const sum = (pick: (item: SkuInventoryWarehouseDto) => string): string =>
      formatQty(warehouses.reduce((acc, item) => acc + parseQty(pick(item)), 0n));
    return {
      skuId,
      skuCode: sku.skuCode,
      skuName: sku.nameZh,
      totals: {
        onHandQty: sum((w) => w.onHandQty),
        reservedQty: sum((w) => w.reservedQty),
        pickedQty: sum((w) => w.pickedQty),
        physicalAvailableQty: sum((w) => w.physicalAvailableQty),
        safetyQty: sum((w) => w.safetyQty),
        sellableAvailableQty: sum((w) => w.sellableAvailableQty),
      },
      warehouses,
      bins,
    };
  }

  async listTransactions(
    filters: TransactionListFilters,
    page: { page: number; pageSize: number },
  ): Promise<{ items: TransactionDto[]; meta: PageMeta }> {
    const { rows, total } = await this.ledgerRepo.listWithRefs(
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    return {
      items: rows.map(({ transaction, ...refs }) => ({
        id: transaction.id,
        transactionNo: transaction.transactionNo,
        eventNo: refs.eventNo,
        eventType: refs.eventType,
        transactionType: transaction.transactionType,
        skuId: transaction.skuId,
        skuCode: refs.skuCode,
        warehouseId: transaction.warehouseId,
        warehouseCode: refs.warehouseCode,
        binId: transaction.binId,
        binCode: refs.binCode,
        quantityBefore: transaction.quantityBefore,
        quantityChange: transaction.quantityChange,
        quantityAfter: transaction.quantityAfter,
        reservedBefore: transaction.reservedBefore,
        reservedChange: transaction.reservedChange,
        reservedAfter: transaction.reservedAfter,
        pickedBefore: transaction.pickedBefore,
        pickedChange: transaction.pickedChange,
        pickedAfter: transaction.pickedAfter,
        referenceType: transaction.referenceType,
        referenceId: transaction.referenceId,
        operatorId: transaction.operatorId,
        operatorName: refs.operatorName,
        remark: transaction.remark,
        createdAt: transaction.createdAt,
      })),
      meta: { page: page.page, pageSize: page.pageSize, total },
    };
  }

  async listReservations(
    filters: ReservationListFilters,
    page: { page: number; pageSize: number },
  ): Promise<{ items: ReservationListItemDto[]; meta: PageMeta }> {
    const { rows, total } = await this.reservationRepo.listWithRefs(
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    return {
      items: rows.map(({ reservation, skuCode, warehouseCode }) => ({
        id: reservation.id,
        reservationNo: reservation.reservationNo,
        skuId: reservation.skuId,
        skuCode,
        warehouseId: reservation.warehouseId,
        warehouseCode,
        referenceType: reservation.referenceType,
        referenceId: reservation.referenceId,
        requestedQty: reservation.requestedQty,
        status: reservation.status,
        remark: reservation.remark,
        createdAt: reservation.createdAt,
        pickedAt: reservation.pickedAt,
        releasedAt: reservation.releasedAt,
        consumedAt: reservation.consumedAt,
      })),
      meta: { page: page.page, pageSize: page.pageSize, total },
    };
  }

  async getReservation(id: string): Promise<ReservationDto> {
    const reservation = await this.reservationRepo.findById(id);
    if (reservation === null) {
      throw new ReservationNotFoundError(id);
    }
    return this.reservationService.buildDtoWithCodes(reservation, false);
  }

  /** Serial occupancy of a reservation (Sprint 3 picking workflow read model). */
  async listReservationSerials(
    reservationId: string,
  ): Promise<Array<{ serialNumber: string; status: string; pickingTaskItemId: string | null }>> {
    const serials = await this.serialRepo.findByReservationId(reservationId);
    return serials.map((serial) => ({
      serialNumber: serial.serialNumber,
      status: serial.status,
      pickingTaskItemId: serial.pickingTaskItemId,
    }));
  }

  /**
   * Single-serial lookup for cross-module scan validation (Sprint 4 packing
   * + interception): is this SN known, and does it belong to the expected
   * SKU / reservation with the expected status?
   */
  async findSerialByNumber(serialNumber: string): Promise<{
    serialNumber: string;
    skuId: string;
    warehouseId: string;
    binId: string | null;
    status: string;
    reservationId: string | null;
  } | null> {
    const serial = await this.dataSource
      .getRepository(InventorySerialEntity)
      .findOneBy({ serialNumber });
    if (serial === null) {
      return null;
    }
    return {
      serialNumber: serial.serialNumber,
      skuId: serial.skuId,
      warehouseId: serial.warehouseId,
      binId: serial.binId,
      status: serial.status,
      reservationId: serial.reservationId,
    };
  }

  private toRowDto(row: {
    balance: {
      id: string;
      skuId: string;
      warehouseId: string;
      binId: string;
      inventoryCondition: string;
      onHandQty: string;
      reservedQty: string;
      pickedQty: string;
    };
    skuCode: string;
    skuName: string;
    warehouseCode: string;
    warehouseName: string;
    binCode: string;
    safetyQty: string | null;
  }): InventoryRowDto {
    const physical =
      parseQty(row.balance.onHandQty) -
      parseQty(row.balance.reservedQty) -
      parseQty(row.balance.pickedQty);
    const safety = row.safetyQty === null ? 0n : parseQty(row.safetyQty);
    // Non-sellable rows (QC_PENDING / DEFECTIVE / ...) contribute nothing to
    // SELLABLE Available even though they are physically on hand.
    const sellableOnHand = isSellableCondition(row.balance.inventoryCondition)
      ? parseQty(row.balance.onHandQty) -
        parseQty(row.balance.reservedQty) -
        parseQty(row.balance.pickedQty)
      : 0n;
    const sellable = sellableOf(sellableOnHand, safety);
    return {
      id: row.balance.id,
      skuId: row.balance.skuId,
      skuCode: row.skuCode,
      skuName: row.skuName,
      warehouseId: row.balance.warehouseId,
      warehouseCode: row.warehouseCode,
      warehouseName: row.warehouseName,
      binId: row.balance.binId,
      binCode: row.binCode,
      condition: row.balance.inventoryCondition as InventoryCondition,
      onHandQty: row.balance.onHandQty,
      reservedQty: row.balance.reservedQty,
      pickedQty: row.balance.pickedQty,
      physicalAvailableQty: formatQty(physical),
      safetyQty: formatQty(safety),
      sellableAvailableQty: formatQty(sellable),
      status: physical > 0n ? 'IN_STOCK' : 'OUT_OF_STOCK',
    };
  }
  /**
   * Replenishment suggestions (Sprint 10 T4): an ADVISORY derivation, never
   * a stock fact. For every active SKU:
   *
   *   dailyVelocity   = shipped qty in window / windowDays
   *   projected       = available + open PO quantity (already bought)
   *   suggestedQty    = ceil(dailyVelocity * coverDays + safety - projected)
   *                     when positive, else 0 (no suggestion)
   *
   * `onlyAlert` keeps just the rows with suggestedQty > 0. Sorting: most
   * urgent (largest suggestion / least cover) first.
   */
  async listReplenishmentSuggestions(input: {
    windowDays: number;
    coverDays: number;
    onlyAlert: boolean;
    keyword?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: Array<Record<string, unknown>>; meta: PageMeta }> {
    const facts = await this.replenishmentRepo.gatherFacts(input.windowDays);
    const windowDays = BigInt(Math.max(1, input.windowDays));

    let rows = facts.map((fact) => {
      const available = parseQty(fact.availableQty);
      const safety = parseQty(fact.safetyQty);
      const shipped = parseQty(fact.shippedQty);
      const openPo = parseQty(fact.openPoQty);
      const dailyVelocity = (shipped * 1000n + windowDays * 500n) / (windowDays * 1000n); // half-up /windowDays
      const projected = available + openPo;
      const target = dailyVelocity * BigInt(Math.max(0, input.coverDays)) + safety;
      const gap = target - projected;
      const suggestedQty = gap > 0n ? ((gap + 999n) / 1000n) * 1000n : 0n; // ceil to whole units
      return {
        skuId: fact.skuId,
        skuCode: fact.skuCode,
        skuName: fact.skuName,
        skuStatus: fact.skuStatus,
        onHandQty: formatQty(parseQty(fact.onHandQty)),
        reservedQty: formatQty(parseQty(fact.reservedQty)),
        pickedQty: formatQty(parseQty(fact.pickedQty)),
        availableQty: formatQty(available),
        safetyQty: formatQty(safety),
        shippedInWindowQty: formatQty(shipped),
        dailyVelocityQty: formatQty(dailyVelocity),
        openPoQty: formatQty(openPo),
        suggestedQty: formatQty(suggestedQty),
        needsReplenishment: suggestedQty > 0n,
      };
    });

    if (input.keyword !== undefined && input.keyword !== '') {
      const keyword = input.keyword.toLowerCase();
      rows = rows.filter(
        (row) =>
          String(row.skuCode).toLowerCase().includes(keyword) ||
          String(row.skuName).toLowerCase().includes(keyword),
      );
    }
    if (input.onlyAlert) {
      rows = rows.filter((row) => row.needsReplenishment);
    }
    rows.sort((a, b) => {
      const bySuggested = parseQty(String(b.suggestedQty)) - parseQty(String(a.suggestedQty));
      if (bySuggested !== 0n) {
        return bySuggested > 0n ? 1 : -1;
      }
      const aAvail = parseQty(String(a.availableQty));
      const bAvail = parseQty(String(b.availableQty));
      return aAvail < bAvail ? -1 : aAvail > bAvail ? 1 : 0;
    });

    const total = rows.length;
    const start = (input.page - 1) * input.pageSize;
    return {
      items: rows.slice(start, start + input.pageSize),
      meta: { page: input.page, pageSize: input.pageSize, total },
    };
  }
}
