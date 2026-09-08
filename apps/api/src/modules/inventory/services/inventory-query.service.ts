import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
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
import { InventoryCondition } from '../enums/inventory.constants';

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
  ) {}

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
    const { rows } = await listBalancesWithRefs(this.dataSource, { skuId }, 1000, 0);
    const bins = rows.map((row) => this.toRowDto(row));

    const warehouseMap = new Map<string, SkuInventoryWarehouseDto>();
    for (const row of rows) {
      const millistream = {
        onHand: qtyFromDb(row.balance.onHandQty),
        reserved: qtyFromDb(row.balance.reservedQty),
        picked: qtyFromDb(row.balance.pickedQty),
        safety: row.safetyQty === null ? 0n : parseQty(row.safetyQty),
      };
      const existing = warehouseMap.get(row.balance.warehouseId);
      if (existing === undefined) {
        const physical = millistream.onHand - millistream.reserved - millistream.picked;
        const sellable = physical - millistream.safety > 0n ? physical - millistream.safety : 0n;
        warehouseMap.set(row.balance.warehouseId, {
          warehouseId: row.balance.warehouseId,
          warehouseCode: row.warehouseCode,
          warehouseName: row.warehouseName,
          onHandQty: formatQty(millistream.onHand),
          reservedQty: formatQty(millistream.reserved),
          pickedQty: formatQty(millistream.picked),
          physicalAvailableQty: formatQty(physical),
          safetyQty: formatQty(millistream.safety),
          sellableAvailableQty: formatQty(sellable),
        });
      } else {
        const onHand = parseQty(existing.onHandQty) + millistream.onHand;
        const reserved = parseQty(existing.reservedQty) + millistream.reserved;
        const picked = parseQty(existing.pickedQty) + millistream.picked;
        const safety = parseQty(existing.safetyQty) + millistream.safety;
        const physical = onHand - reserved - picked;
        const sellable = physical - safety > 0n ? physical - safety : 0n;
        existing.onHandQty = formatQty(onHand);
        existing.reservedQty = formatQty(reserved);
        existing.pickedQty = formatQty(picked);
        existing.physicalAvailableQty = formatQty(physical);
        existing.safetyQty = formatQty(safety);
        existing.sellableAvailableQty = formatQty(sellable);
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
    const sellable = physical - safety > 0n ? physical - safety : 0n;
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
}
