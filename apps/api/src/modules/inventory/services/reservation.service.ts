import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { SkuService } from '../../product/services/sku.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { WarehouseBinService } from '../../warehouse/services/warehouse-bin.service';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { randomUUID } from 'node:crypto';
import { formatQty, parseQty, qtyFromDb } from '../../../common/utils/quantity';
import { InventoryBalanceEntity } from '../entities/inventory-balance.entity';
import { InventoryReservationEntity } from '../entities/inventory-reservation.entity';
import { InventoryReservationLineEntity } from '../entities/inventory-reservation-line.entity';
import {
  ReservationStatus,
  ReservationReferenceType,
  RESERVATION_TRANSITIONS,
} from '../enums/inventory.constants';
import {
  IdempotencyConflictError,
  InsufficientStockError,
  InventoryQuantityInvalidError,
  InvalidReservationStateError,
  ReservationNotFoundError,
  SkuNotFoundInvariantError,
  BalanceMissingInvariantError,
} from '../errors/inventory.errors';
import { SkuNotFoundError } from '../../product/errors/sku-errors';
import { WarehouseNotFoundError } from '../../warehouse/errors/warehouse-errors';
import { InventoryBalanceRepository } from '../repositories/inventory-balance.repository';
import { InventoryReservationRepository } from '../repositories/inventory-reservation.repository';
import {
  InventoryTransactionRepository,
  LedgerLineInsert,
} from '../repositories/inventory-transaction.repository';
import { assertBalanceInvariants, nextVersionOf, physicalAvailableOf } from './inventory-dimension';
import { isUniqueViolationOn } from './inventory.service';

export interface ReserveStockInput {
  skuId: string;
  warehouseId: string;
  quantity: string;
  referenceType: ReservationReferenceType;
  referenceId: string;
  idempotencyKey: string;
  remark?: string | null;
  operator: OperatorContext;
}

export interface ReservationLineDto {
  id: string;
  binId: string;
  binCode: string;
  quantity: string;
  pickedQty: string;
  status: string;
}

export interface ReservationDto {
  id: string;
  reservationNo: string;
  skuId: string;
  skuCode: string;
  warehouseId: string;
  warehouseCode: string;
  referenceType: string;
  referenceId: string;
  requestedQty: string;
  status: ReservationStatus;
  remark: string | null;
  createdAt: Date;
  pickedAt: Date | null;
  releasedAt: Date | null;
  consumedAt: Date | null;
  lines: ReservationLineDto[];
  idempotentReplay: boolean;
}

export interface LifecycleInput {
  operator: OperatorContext;
  /** Optional business key; same key replays the first execution (task §30). */
  idempotencyKey?: string;
  remark?: string | null;
}

type LifecycleOp = 'RELEASE' | 'PICK' | 'UNPICK' | 'SHIP';

/**
 * Reservation engine (task §23-§35): reserve with greedy per-bin allocation
 * in deterministic bin_code order under SELECT ... FOR UPDATE, then the
 * ACTIVE -> PICKED -> CONSUMED lifecycle plus release/unpick.
 *
 * Concurrency: one DB transaction per action; candidate balance rows are
 * locked one-by-one in bin_code order BEFORE re-computing availability
 * (task §27), so the last item can only be won once (task §59).
 *
 * Pool discipline: while a QueryRunner transaction is open, EVERY query runs
 * on the runner's own connection - never on the shared pool - so concurrent
 * requests cannot self-deadlock the pool. Master-data/enrichment lookups run
 * AFTER the runner is released.
 */
@Injectable()
export class ReservationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly balanceRepo: InventoryBalanceRepository,
    private readonly reservationRepo: InventoryReservationRepository,
    private readonly ledgerRepo: InventoryTransactionRepository,
    private readonly skuService: SkuService,
    private readonly warehouseService: WarehouseService,
    private readonly binService: WarehouseBinService,
  ) {}

  // --------------------------------------------------------------------------
  // Reserve
  // --------------------------------------------------------------------------

  async reserveStock(input: ReserveStockInput): Promise<ReservationDto> {
    const qty = parseQty(input.quantity);
    if (qty <= 0n) {
      throw new InventoryQuantityInvalidError('预约数量必须大于 0');
    }
    const sku = await this.skuService.getEntityById(input.skuId);
    if (sku === null) {
      throw new SkuNotFoundError(input.skuId);
    }
    const warehouse = await this.warehouseService.getEntityById(input.warehouseId);
    if (warehouse === null) {
      throw new WarehouseNotFoundError(input.warehouseId);
    }

    const existing = await this.reservationRepo.findByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) {
      return this.replayReservation(existing, input);
    }

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let committed: InventoryReservationEntity | undefined;
    let replayed: InventoryReservationEntity | undefined;
    try {
      // 1-2. Candidate balances, locked one row at a time in bin_code order.
      const balances = await this.balanceRepo.lockAllInBinOrder(
        runner,
        input.skuId,
        input.warehouseId,
      );

      // Idempotency re-check AFTER the locks (task §61): concurrent duplicates
      // of this key serialize here and see the winner's committed row.
      const raced = await this.reservationRepo.findByIdempotencyKeyTx(runner, input.idempotencyKey);
      if (raced !== null) {
        await runner.rollbackTransaction();
        replayed = raced;
      } else {
        // 3-5. Total availability against freshly locked rows; atomic failure.
        const totalAvailable = balances.reduce(
          (sum, balance) => sum + physicalAvailableOf(balance),
          0n,
        );
        if (totalAvailable < qty) {
          throw new InsufficientStockError({
            skuId: input.skuId,
            warehouseId: input.warehouseId,
            requestedQty: formatQty(qty),
            availableQty: formatQty(totalAvailable),
          });
        }

        // 6. Greedy allocation in bin_code order (task §24-§25).
        const allocations: Array<{ balance: InventoryBalanceEntity; alloc: bigint }> = [];
        let remaining = qty;
        for (const balance of balances) {
          if (remaining === 0n) {
            break;
          }
          const free = physicalAvailableOf(balance);
          if (free <= 0n) {
            continue;
          }
          const take = free < remaining ? free : remaining;
          allocations.push({ balance, alloc: take });
          remaining -= take;
        }

        const reservationNo = await this.reservationRepo.nextReservationNo(runner);
        const reservation = await this.reservationRepo.insert(
          runner,
          {
            reservationNo,
            skuId: input.skuId,
            warehouseId: input.warehouseId,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            requestedQty: formatQty(qty),
            status: 'ACTIVE',
            idempotencyKey: input.idempotencyKey,
            remark: input.remark ?? null,
          },
          allocations.map(({ balance, alloc }) => ({
            binId: balance.binId,
            quantity: formatQty(alloc),
          })),
        );

        // 7. reserved_qty += N per allocated bin + ledger event (task §27).
        const ledgerLines: LedgerLineInsert[] = [];
        for (const { balance, alloc } of allocations) {
          const reservedAfter = qtyFromDb(balance.reservedQty) + alloc;
          const patch = {
            onHandQty: balance.onHandQty,
            reservedQty: formatQty(reservedAfter),
            pickedQty: balance.pickedQty,
            version: nextVersionOf(balance),
          };
          assertBalanceInvariants(patch);
          await this.balanceRepo.saveQuantities(runner, balance.id, patch);
          ledgerLines.push({
            skuId: input.skuId,
            warehouseId: input.warehouseId,
            binId: balance.binId,
            transactionType: 'RESERVE',
            quantityBefore: balance.onHandQty,
            quantityChange: '0.000',
            quantityAfter: balance.onHandQty,
            reservedBefore: balance.reservedQty,
            reservedChange: formatQty(alloc),
            reservedAfter: patch.reservedQty,
          });
        }
        await this.ledgerRepo.insertEventWithLines(
          runner,
          {
            eventType: 'RESERVE',
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            idempotencyKey: input.idempotencyKey,
            operatorId: input.operator.userId,
            remark: `reservation=${reservationNo}${suffixRemark(input.remark)}`,
          },
          ledgerLines,
        );

        await runner.commitTransaction();
        committed = reservation;
      }
    } catch (error: unknown) {
      await runner.rollbackTransaction();
      if (isUniqueViolationOn(error, 'uq_inventory_reservations_idem')) {
        // Same key committed concurrently against a different balance set.
        const raced = await this.reservationRepo.findByIdempotencyKey(input.idempotencyKey);
        if (raced !== null) {
          return this.replayReservation(raced, input);
        }
      }
      throw error;
    } finally {
      await runner.release();
    }

    if (replayed !== undefined) {
      return this.replayReservation(replayed, input);
    }
    return this.buildDtoWithCodes(committed as InventoryReservationEntity, false);
  }

  // --------------------------------------------------------------------------
  // Lifecycle: release / pick / unpick / ship
  // --------------------------------------------------------------------------

  async releaseReservation(reservationId: string, input: LifecycleInput): Promise<ReservationDto> {
    return this.lifecycle('RELEASE', reservationId, input);
  }

  async pickStock(reservationId: string, input: LifecycleInput): Promise<ReservationDto> {
    return this.lifecycle('PICK', reservationId, input);
  }

  async unpickStock(reservationId: string, input: LifecycleInput): Promise<ReservationDto> {
    return this.lifecycle('UNPICK', reservationId, input);
  }

  async shipStock(reservationId: string, input: LifecycleInput): Promise<ReservationDto> {
    return this.lifecycle('SHIP', reservationId, input);
  }

  private async lifecycle(
    op: LifecycleOp,
    reservationId: string,
    input: LifecycleInput,
  ): Promise<ReservationDto> {
    const target: ReservationStatus =
      op === 'RELEASE'
        ? 'RELEASED'
        : op === 'PICK'
          ? 'PICKED'
          : op === 'UNPICK'
            ? 'ACTIVE'
            : 'CONSUMED';
    const eventKey = `${op}:${reservationId}:${input.idempotencyKey ?? randomUUID()}`;

    if (input.idempotencyKey !== undefined) {
      const existingEvent = await this.ledgerRepo.findEventByIdempotencyKey(eventKey);
      if (existingEvent !== null) {
        const reservation = await this.reservationRepo.findById(reservationId);
        if (reservation === null) {
          throw new ReservationNotFoundError(reservationId);
        }
        return this.buildDtoWithCodes(reservation, true);
      }
    }

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let finished: InventoryReservationEntity | undefined;
    try {
      const reservation = await this.reservationRepo.lockById(runner, reservationId);
      if (reservation === null) {
        throw new ReservationNotFoundError(reservationId);
      }
      if (!RESERVATION_TRANSITIONS[reservation.status].includes(target)) {
        throw new InvalidReservationStateError({
          reservationId,
          currentStatus: reservation.status,
          attemptedAction: op,
        });
      }

      const lines = await this.reservationRepo.findLinesTx(runner, reservationId);
      // Deterministic order for both balance locking and ledger lines (task §73).
      const orderedLines = await sortLinesByBinCodeOnRunner(runner, lines);

      const ledgerLines: LedgerLineInsert[] = [];
      for (const line of orderedLines) {
        const lineQty = parseQty(line.quantity);
        const balance = await this.balanceRepo.lockByDim(runner, {
          skuId: reservation.skuId,
          warehouseId: reservation.warehouseId,
          binId: line.binId,
          condition: 'SELLABLE',
        });
        if (balance === null) {
          throw new BalanceMissingInvariantError({
            skuId: reservation.skuId,
            warehouseId: reservation.warehouseId,
            binId: line.binId,
          });
        }

        const onHand = qtyFromDb(balance.onHandQty);
        const reserved = qtyFromDb(balance.reservedQty);
        const picked = qtyFromDb(balance.pickedQty);

        let nextOnHand = onHand;
        let nextReserved = reserved;
        let nextPicked = picked;
        if (op === 'RELEASE') {
          nextReserved = reserved - lineQty; // Reserved - N, On Hand unchanged (task §29)
        } else if (op === 'PICK') {
          nextReserved = reserved - lineQty; // Reserved - N, Picked + N (task §31)
          nextPicked = picked + lineQty;
        } else if (op === 'UNPICK') {
          nextPicked = picked - lineQty; // Picked - N, Reserved + N (task §33)
          nextReserved = reserved + lineQty;
        } else {
          nextPicked = picked - lineQty; // Picked - N, On Hand - N (task §34)
          nextOnHand = onHand - lineQty;
        }

        const patch = {
          onHandQty: formatQty(nextOnHand),
          reservedQty: formatQty(nextReserved),
          pickedQty: formatQty(nextPicked),
          version: nextVersionOf(balance),
        };
        assertBalanceInvariants(patch);
        await this.balanceRepo.saveQuantities(runner, balance.id, patch);

        ledgerLines.push({
          skuId: reservation.skuId,
          warehouseId: reservation.warehouseId,
          binId: line.binId,
          transactionType: op,
          quantityBefore: balance.onHandQty,
          quantityChange: formatQty(nextOnHand - onHand),
          quantityAfter: patch.onHandQty,
          reservedBefore: op === 'SHIP' ? null : balance.reservedQty,
          reservedChange: op === 'SHIP' ? null : formatQty(nextReserved - reserved),
          reservedAfter: op === 'SHIP' ? null : patch.reservedQty,
          pickedBefore: op === 'RELEASE' ? null : balance.pickedQty,
          pickedChange: op === 'RELEASE' ? null : formatQty(nextPicked - picked),
          pickedAfter: op === 'RELEASE' ? null : patch.pickedQty,
          remark: `reservation=${reservation.reservationNo}`,
        });

        const linePatch =
          op === 'RELEASE'
            ? { status: 'RELEASED' as const }
            : op === 'PICK'
              ? { status: 'PICKED' as const, pickedQty: line.quantity }
              : op === 'UNPICK'
                ? { status: 'ACTIVE' as const, pickedQty: '0.000' }
                : { status: 'CONSUMED' as const };
        await this.reservationRepo.updateLine(runner, line.id, linePatch);
      }

      await this.ledgerRepo.insertEventWithLines(
        runner,
        {
          eventType: op,
          referenceType: reservation.referenceType,
          referenceId: reservation.referenceId,
          idempotencyKey: eventKey,
          operatorId: input.operator.userId,
          remark: `reservation=${reservation.reservationNo}${suffixRemark(input.remark)}`,
        },
        ledgerLines,
      );

      const now = new Date();
      const headerPatch: Partial<InventoryReservationEntity> =
        op === 'RELEASE'
          ? { status: 'RELEASED', releasedAt: now }
          : op === 'PICK'
            ? { status: 'PICKED', pickedAt: now }
            : op === 'UNPICK'
              ? { status: 'ACTIVE', pickedAt: null }
              : { status: 'CONSUMED', consumedAt: now };
      await this.reservationRepo.updateStatus(runner, reservationId, headerPatch);

      await runner.commitTransaction();
      finished = { ...reservation, ...headerPatch };
    } finally {
      await runner.release();
    }

    return this.buildDtoWithCodes(finished, false);
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** Duplicate-key guard: same key must carry the same business payload. */
  private async replayReservation(
    existing: InventoryReservationEntity,
    input: ReserveStockInput,
  ): Promise<ReservationDto> {
    if (
      existing.skuId !== input.skuId ||
      existing.warehouseId !== input.warehouseId ||
      existing.requestedQty !== formatQty(parseQty(input.quantity)) ||
      existing.referenceId !== input.referenceId
    ) {
      throw new IdempotencyConflictError(input.idempotencyKey);
    }
    return this.buildDtoWithCodes(existing, true);
  }

  /** Full DTO with resolved sku/warehouse/bin codes (pool queries - never call inside a transaction). */
  async buildDtoWithCodes(
    reservation: InventoryReservationEntity,
    idempotentReplay: boolean,
  ): Promise<ReservationDto> {
    const [sku, warehouse, lines] = await Promise.all([
      this.skuService.getEntityById(reservation.skuId),
      this.warehouseService.getEntityById(reservation.warehouseId),
      this.reservationRepo.findLines(reservation.id),
    ]);
    if (sku === null) {
      throw new SkuNotFoundInvariantError(reservation.skuId);
    }
    const lineDtos: ReservationLineDto[] = [];
    for (const line of lines) {
      const bin = await this.binService.getEntityById(line.binId);
      lineDtos.push({
        id: line.id,
        binId: line.binId,
        binCode: bin?.binCode ?? '',
        quantity: line.quantity,
        pickedQty: line.pickedQty,
        status: line.status,
      });
    }
    return {
      id: reservation.id,
      reservationNo: reservation.reservationNo,
      skuId: reservation.skuId,
      skuCode: sku.skuCode,
      warehouseId: reservation.warehouseId,
      warehouseCode: warehouse?.warehouseCode ?? '',
      referenceType: reservation.referenceType,
      referenceId: reservation.referenceId,
      requestedQty: reservation.requestedQty,
      status: reservation.status,
      remark: reservation.remark,
      createdAt: reservation.createdAt,
      pickedAt: reservation.pickedAt,
      releasedAt: reservation.releasedAt,
      consumedAt: reservation.consumedAt,
      lines: lineDtos,
      idempotentReplay,
    };
  }
}

function suffixRemark(remark?: string | null): string {
  return remark !== null && remark !== undefined && remark !== '' ? `; ${remark}` : '';
}

/**
 * Sorts reservation lines by bin_code using the runner's own connection
 * (bin codes are master data; sorting must not touch the shared pool while
 * the transaction holds its connection).
 */
async function sortLinesByBinCodeOnRunner(
  runner: QueryRunner,
  lines: InventoryReservationLineEntity[],
): Promise<InventoryReservationLineEntity[]> {
  if (lines.length <= 1) {
    return lines;
  }
  const rows = (await runner.query(
    `SELECT id, bin_code FROM warehouse_bins WHERE id = ANY($1::uuid[])`,
    [lines.map((line) => line.binId)],
  )) as Array<{ id: string; bin_code: string }>;
  const codes = new Map(rows.map((row) => [row.id, row.bin_code]));
  return [...lines].sort((a, b) => {
    const codeA = codes.get(a.binId) ?? '';
    const codeB = codes.get(b.binId) ?? '';
    return codeA === codeB ? a.id.localeCompare(b.id) : codeA.localeCompare(codeB);
  });
}
