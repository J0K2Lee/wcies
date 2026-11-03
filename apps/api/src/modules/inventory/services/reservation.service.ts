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
  InventorySerialInvalidError,
  InvalidReservationStateError,
  OrderOwnedReservationError,
  ReservationNotFoundError,
  SkuNotFoundInvariantError,
  BalanceMissingInvariantError,
} from '../errors/inventory.errors';
import { SkuNotFoundError } from '../../product/errors/sku-errors';
import { WarehouseNotFoundError } from '../../warehouse/errors/warehouse-errors';
import { InventoryBalanceRepository } from '../repositories/inventory-balance.repository';
import { InventoryReservationRepository } from '../repositories/inventory-reservation.repository';
import { InventorySerialRepository } from '../repositories/inventory-serial.repository';
import {
  InventoryTransactionRepository,
  LedgerLineInsert,
} from '../repositories/inventory-transaction.repository';
import { assertBalanceInvariants, nextVersionOf, physicalAvailableOf } from './inventory-dimension';
import { isUniqueViolationOn } from './inventory.service';
import { InventorySerialEntity } from '../entities/inventory-serial.entity';

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
  shippedQty: string;
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
  /** Serial occupancy of the reservation (SN-tracked SKUs only). */
  serials: Array<{ serialNumber: string; status: string; pickingTaskItemId: string | null }>;
  idempotentReplay: boolean;
}

export interface LifecycleInput {
  operator: OperatorContext;
  /** Optional business key; same key replays the first execution (task §30). */
  idempotencyKey?: string;
  remark?: string | null;
  /**
   * Internal flag set ONLY by the order domain's own cancel chain (2026-10-15):
   * a `reference_type='ORDER'` reservation may not be released/picked/built
   * out-of-band, because that would move stock without syncing the order line
   * + rollup (悬空占用). The inventory HTTP endpoints never set this, so a
   * manual lifecycle call on an ORDER reservation is rejected.
   */
  orderDomain?: boolean;
}

/**
 * Partial pick (Sprint 3 task §37/§39): move `quantity` units from Reserved
 * to Picked without requiring the whole reservation. Used by the picking
 * scan workflow - one scan = one unit. SN-tracked SKUs must name the exact
 * serials being picked; the serials' bins drive the per-line allocation.
 */
export interface PartialPickInput {
  quantity: string;
  operator: OperatorContext;
  idempotencyKey?: string;
  remark?: string | null;
  /** Required when the SKU is serial-tracked; count must match the quantity. */
  serialNumbers?: string[];
  /** Occupancy trace written onto the picked serials (picking scan path). */
  pickingTaskItemId?: string | null;
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
    private readonly serialRepo: InventorySerialRepository,
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

        // 6b. Serial-tracked SKUs: IN_STOCK serials are selected per allocated
        // bin (same greedy order) and marked RESERVED in THIS transaction, so
        // SN detail and balance stay consistent (Sprint 3 task §43).
        let serialPlan: Array<InventorySerialEntity> = [];
        if (sku.serialTracking) {
          if (qty % 1000n !== 0n) {
            throw new InventorySerialInvalidError('SN 管理商品的预约数量必须为整数件', {
              skuId: input.skuId,
              quantity: input.quantity,
            });
          }
          for (const { balance, alloc } of allocations) {
            const units = alloc / 1000n;
            const picked = await this.serialRepo.lockInStockByBin(runner, {
              skuId: input.skuId,
              warehouseId: input.warehouseId,
              binId: balance.binId,
              units,
            });
            if (BigInt(picked.length) < units) {
              throw new InsufficientStockError({
                skuId: input.skuId,
                warehouseId: input.warehouseId,
                requestedQty: formatQty(qty),
                availableQty: formatQty(totalAvailable),
              });
            }
            serialPlan = serialPlan.concat(picked);
          }
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

        if (serialPlan.length > 0) {
          await this.serialRepo.updateMany(
            runner,
            serialPlan.map((serial) => serial.id),
            { status: 'RESERVED', reservationId: reservation.id },
          );
        }

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

  /**
   * 释放「未拣余量」（2026-11-03，拣货中订单取消）。
   *
   * 场景：一行要 5 件、已拣 2 件时订单被取消。业务口径是「已拣的全部进拦截、
   * 剩余不再拣」——所以要把剩下 3 件从 Reserved 退回可售，同时**不动**已拣的
   * 2 件（它们由拦截任务负责找回入库）。
   *
   * 为什么不能用 `releaseReservation`：RELEASE 按整行 `quantity` 扣 reserved，
   * 部分拣的行 reserved 只剩 3，再减 5 会变负 → 不变量直接炸。
   */
  async releaseRemainder(reservationId: string, input: LifecycleInput): Promise<ReservationDto> {
    const eventKey = `RELEASE_REMAINDER:${reservationId}:${input.idempotencyKey ?? randomUUID()}`;
    if (input.idempotencyKey !== undefined) {
      const existing = await this.ledgerRepo.findEventByIdempotencyKey(eventKey);
      if (existing !== null) {
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
      // 订单来源预约只能走订单域入口（与 lifecycle 同一条纪律）。
      if (reservation.referenceType === 'ORDER' && input.orderDomain !== true) {
        throw new OrderOwnedReservationError({
          reservationId,
          attemptedAction: 'RELEASE_REMAINDER',
        });
      }
      // 已经释放/消耗：幂等重放（余量本来就没了）。
      if (reservation.status === 'RELEASED' || reservation.status === 'CONSUMED') {
        await runner.commitTransaction();
        finished = reservation;
      } else {
        const lines = await this.reservationRepo.findLinesLocked(runner, reservationId);
        const orderedLines = await sortLinesByBinCodeOnRunner(runner, lines);
        const serials = await this.serialRepo.findByReservationIdTx(
          runner,
          reservationId,
          'RESERVED',
        );

        const ledgerLines: LedgerLineInsert[] = [];
        for (const line of orderedLines) {
          const remaining = parseQty(line.quantity) - parseQty(line.pickedQty);
          if (remaining <= 0n) {
            continue; // 该行已全部拣走：没有余量可释放
          }
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
          const reserved = qtyFromDb(balance.reservedQty);
          const patch = {
            onHandQty: balance.onHandQty,
            reservedQty: formatQty(reserved - remaining),
            pickedQty: balance.pickedQty, // 已拣部分不动（拦截负责找回）
            version: nextVersionOf(balance),
          };
          assertBalanceInvariants(patch);
          await this.balanceRepo.saveQuantities(runner, balance.id, patch);
          ledgerLines.push({
            skuId: reservation.skuId,
            warehouseId: reservation.warehouseId,
            binId: line.binId,
            transactionType: 'RELEASE_REMAINDER',
            quantityBefore: balance.onHandQty,
            quantityChange: '0.000',
            quantityAfter: balance.onHandQty,
            reservedBefore: balance.reservedQty,
            reservedChange: formatQty(-remaining),
            reservedAfter: patch.reservedQty,
            pickedBefore: null,
            pickedChange: null,
            pickedAfter: null,
            remark: `reservation=${reservation.reservationNo}${suffixRemark(input.remark)}`,
          });
          await this.reservationRepo.updateLine(runner, line.id, { status: 'RELEASED' });
        }

        // 未拣的序列号回到可售；已拣（PICKED）的保持不动。
        if (serials.length > 0) {
          await this.serialRepo.updateMany(
            runner,
            serials.map((serial) => serial.id),
            { status: 'IN_STOCK', reservationId: null },
          );
        }

        const headerPatch: Partial<InventoryReservationEntity> = {
          status: 'RELEASED',
          releasedAt: new Date(),
        };
        await this.reservationRepo.updateStatus(runner, reservationId, headerPatch);
        if (ledgerLines.length > 0) {
          await this.ledgerRepo.insertEventWithLines(
            runner,
            {
              eventType: 'RELEASE_REMAINDER',
              referenceType: reservation.referenceType,
              referenceId: reservation.referenceId,
              idempotencyKey: eventKey,
              operatorId: input.operator.userId,
              remark: `reservation=${reservation.reservationNo}${suffixRemark(input.remark)}`,
            },
            ledgerLines,
          );
        }
        await runner.commitTransaction();
        finished = { ...reservation, ...headerPatch };
      }
    } catch (error: unknown) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }

    return this.buildDtoWithCodes(finished, false);
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
    let alreadyTerminal = false;
    try {
      const reservation = await this.reservationRepo.lockById(runner, reservationId);
      if (reservation === null) {
        throw new ReservationNotFoundError(reservationId);
      }
      // 订单来源预约只能走订单域入口（2026-10-15）：裸生命周期会改库存却不同步
      // 订单行状态/rollup，制造悬空占用。订单域的取消链路显式传 orderDomain=true。
      if (reservation.referenceType === 'ORDER' && input.orderDomain !== true) {
        throw new OrderOwnedReservationError({
          reservationId,
          attemptedAction: op,
        });
      }
      // 订单域取消的幂等兜底（悬空占用自愈）：预约已处于目标终态时直接复用结果，
      // 不再走状态机（RELEASED→RELEASED 无出边）。这是「订单行仍显示已占用、
      // 预约已被外部释放」的历史悬空行在取消时能收口的必要路径。DTO 在 runner
      // 释放后再构建（本文件池纪律：事务内不跑池查询）。
      if (input.orderDomain === true && reservation.status === target) {
        await runner.commitTransaction();
        finished = reservation;
        alreadyTerminal = true;
      } else {
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

        // Serial lifecycle follows the reservation in the SAME transaction
        // (Sprint 3 task §43); non-serial SKUs have no serial rows at all.
        const serials = await this.serialRepo.findByReservationIdTx(
          runner,
          reservationId,
          {
            RELEASE: 'RESERVED',
            PICK: 'RESERVED',
            UNPICK: 'PICKED',
            SHIP: 'PICKED',
          }[op] as 'RESERVED' | 'PICKED',
        );

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

        if (serials.length > 0) {
          const serialPatch =
            op === 'RELEASE'
              ? { status: 'IN_STOCK' as const, reservationId: null }
              : op === 'PICK'
                ? { status: 'PICKED' as const }
                : op === 'UNPICK'
                  ? { status: 'RESERVED' as const, pickingTaskItemId: null }
                  : { status: 'SHIPPED' as const };
          await this.serialRepo.updateMany(
            runner,
            serials.map((serial) => serial.id),
            serialPatch,
          );
        }

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
      }
    } finally {
      await runner.release();
    }

    return this.buildDtoWithCodes(finished, alreadyTerminal);
  }

  // --------------------------------------------------------------------------
  // Partial pick (Sprint 3 picking workflow: one scan = one unit)
  // --------------------------------------------------------------------------

  /**
   * Moves `quantity` from Reserved to Picked without requiring the whole
   * reservation (Sprint 3 task §37/§39). Same locking discipline as the full
   * lifecycle: header lock -> line locks in bin_code order -> per-line balance
   * FOR UPDATE -> ledger event. The header stays ACTIVE while any line is
   * partially picked and flips to PICKED only when every line is complete.
   *
   * SN-tracked SKUs must name their serials; the serials' bins drive which
   * lines are decremented, so bin-level balance and serial detail can never
   * disagree.
   */
  async pickStockPartial(reservationId: string, input: PartialPickInput): Promise<ReservationDto> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let finished!: InventoryReservationEntity;
    let replayed!: boolean;
    try {
      const outcome = await this.pickStockPartialInTx(runner, reservationId, input);
      finished = outcome.reservation;
      replayed = outcome.idempotentReplay;
      await runner.commitTransaction();
    } catch (error: unknown) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
    return this.buildDtoWithCodes(finished, replayed);
  }

  /**
   * Transaction-aware partial pick (Sprint 4 P0, task §3-§5): runs the SAME
   * locked-balance logic on the CALLER's QueryRunner so the picking business
   * command (PickingTaskItem increment + inventory Reserved->Picked +
   * OrderItem status) commits or rolls back as ONE database transaction.
   * Inventory still owns every stock rule; the caller only owns the
   * transaction boundary. All queries run on the runner's connection - never
   * the shared pool - while the transaction is open.
   */
  async pickStockPartialInTx(
    runner: QueryRunner,
    reservationId: string,
    input: PartialPickInput,
  ): Promise<{ reservation: InventoryReservationEntity; idempotentReplay: boolean }> {
    const qty = parseQty(input.quantity);
    if (qty <= 0n) {
      throw new InventoryQuantityInvalidError('部分拣货数量必须大于 0');
    }
    const eventKey = `PICK:${reservationId}:${input.idempotencyKey ?? randomUUID()}`;

    if (input.idempotencyKey !== undefined) {
      const existingEvent = await this.ledgerRepo.findEventByIdempotencyKeyTx(runner, eventKey);
      if (existingEvent !== null) {
        const reservation = await this.reservationRepo.lockById(runner, reservationId);
        if (reservation === null) {
          throw new ReservationNotFoundError(reservationId);
        }
        return { reservation, idempotentReplay: true };
      }
    }

    const reservation = await this.reservationRepo.lockById(runner, reservationId);
    if (reservation === null) {
      throw new ReservationNotFoundError(reservationId);
    }
    if (reservation.status !== 'ACTIVE') {
      throw new InvalidReservationStateError({
        reservationId,
        currentStatus: reservation.status,
        attemptedAction: 'PICK_PARTIAL',
      });
    }

    const lines = await this.reservationRepo.findLinesLocked(runner, reservationId);
    const orderedLines = await sortLinesByBinCodeOnRunner(runner, lines);
    const serialTracked = await skuSerialTrackedOnRunner(runner, reservation.skuId);

    // Plan the per-line take.
    const lineTakes = new Map<string, bigint>();
    let pickedSerials: InventorySerialEntity[] = [];
    if (serialTracked) {
      const serialNumbers = [...new Set((input.serialNumbers ?? []).map((sn) => sn.trim()))].filter(
        (sn) => sn !== '',
      );
      if (input.serialNumbers === undefined || serialNumbers.length === 0) {
        throw new InventorySerialInvalidError('SN 管理商品拣货必须提供 serialNumber', {
          reservationId,
        });
      }
      if (qty % 1000n !== 0n || BigInt(serialNumbers.length) * 1000n !== qty) {
        throw new InventorySerialInvalidError('拣货数量与 serialNumber 数量不一致', {
          reservationId,
          quantity: input.quantity,
          serialCount: serialNumbers.length,
        });
      }
      pickedSerials = await this.serialRepo.lockBySerialNumbers(runner, serialNumbers);
      const byNumber = new Map(pickedSerials.map((serial) => [serial.serialNumber, serial]));
      for (const serialNumber of serialNumbers) {
        const serial = byNumber.get(serialNumber);
        if (
          serial === undefined ||
          serial.reservationId !== reservationId ||
          serial.status !== 'RESERVED' ||
          serial.skuId !== reservation.skuId
        ) {
          throw new InventorySerialInvalidError('SN 不属于该预约或状态不允许拣货', {
            reservationId,
            serialNumber,
          });
        }
      }
      // Serial bins drive the line allocation (one unit per serial).
      const remainingOf = new Map(
        orderedLines.map((line) => [line.id, parseQty(line.quantity) - parseQty(line.pickedQty)]),
      );
      for (const serial of pickedSerials) {
        const target = orderedLines.find((line) => line.binId === serial.binId);
        const headroom = target === undefined ? 0n : (remainingOf.get(target.id) ?? 0n);
        if (target === undefined || headroom < 1000n) {
          throw new InventorySerialInvalidError('SN 所在库位与预约分配行不匹配', {
            reservationId,
            serialNumber: serial.serialNumber,
            binId: serial.binId,
          });
        }
        remainingOf.set(target.id, headroom - 1000n);
        lineTakes.set(target.id, (lineTakes.get(target.id) ?? 0n) + 1000n);
      }
    } else {
      if (input.serialNumbers !== undefined && input.serialNumbers.length > 0) {
        throw new InventorySerialInvalidError('非 SN 管理商品不能提供 serialNumber', {
          reservationId,
        });
      }
      let remaining = qty;
      for (const line of orderedLines) {
        if (remaining === 0n) {
          break;
        }
        const pickable = parseQty(line.quantity) - parseQty(line.pickedQty);
        if (pickable <= 0n) {
          continue;
        }
        const take = pickable < remaining ? pickable : remaining;
        lineTakes.set(line.id, take);
        remaining -= take;
      }
      if (remaining > 0n) {
        throw new InvalidReservationStateError({
          reservationId,
          currentStatus: reservation.status,
          attemptedAction: 'PICK_PARTIAL',
        });
      }
    }

    const ledgerLines: LedgerLineInsert[] = [];
    let allLinesFullyPicked = true;
    for (const line of orderedLines) {
      const take = lineTakes.get(line.id) ?? 0n;
      const linePickedAfter = parseQty(line.pickedQty) + take;
      if (take === 0n) {
        allLinesFullyPicked = allLinesFullyPicked && linePickedAfter === parseQty(line.quantity);
        continue;
      }
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
      const reserved = qtyFromDb(balance.reservedQty);
      const picked = qtyFromDb(balance.pickedQty);
      const patch = {
        onHandQty: balance.onHandQty,
        reservedQty: formatQty(reserved - take), // Reserved - N, Picked + N (task §31)
        pickedQty: formatQty(picked + take),
        version: nextVersionOf(balance),
      };
      assertBalanceInvariants(patch);
      await this.balanceRepo.saveQuantities(runner, balance.id, patch);
      ledgerLines.push({
        skuId: reservation.skuId,
        warehouseId: reservation.warehouseId,
        binId: line.binId,
        transactionType: 'PICK',
        quantityBefore: balance.onHandQty,
        quantityChange: '0.000',
        quantityAfter: balance.onHandQty,
        reservedBefore: balance.reservedQty,
        reservedChange: formatQty(-take),
        reservedAfter: patch.reservedQty,
        pickedBefore: balance.pickedQty,
        pickedChange: formatQty(take),
        pickedAfter: patch.pickedQty,
        remark: `reservation=${reservation.reservationNo}`,
      });

      const fullyPicked = linePickedAfter === parseQty(line.quantity);
      allLinesFullyPicked = allLinesFullyPicked && fullyPicked;
      await this.reservationRepo.updateLine(runner, line.id, {
        pickedQty: formatQty(linePickedAfter),
        status: fullyPicked ? 'PICKED' : 'ACTIVE',
      });
    }

    if (pickedSerials.length > 0) {
      await this.serialRepo.updateMany(
        runner,
        pickedSerials.map((serial) => serial.id),
        { status: 'PICKED', pickingTaskItemId: input.pickingTaskItemId ?? null },
      );
    }

    await this.ledgerRepo.insertEventWithLines(
      runner,
      {
        eventType: 'PICK',
        referenceType: reservation.referenceType,
        referenceId: reservation.referenceId,
        idempotencyKey: eventKey,
        operatorId: input.operator.userId,
        remark: `reservation=${reservation.reservationNo}; partial=${formatQty(qty)}${suffixRemark(input.remark)}`,
      },
      ledgerLines,
    );

    if (allLinesFullyPicked) {
      const headerPatch: Partial<InventoryReservationEntity> = {
        status: 'PICKED',
        pickedAt: reservation.pickedAt ?? new Date(),
      };
      await this.reservationRepo.updateStatus(runner, reservationId, headerPatch);
      return { reservation: { ...reservation, ...headerPatch }, idempotentReplay: false };
    }
    return { reservation, idempotentReplay: false };
  }

  // --------------------------------------------------------------------------
  // Partial ship (Sprint 4: one order item may ship across several shipments)
  // --------------------------------------------------------------------------

  /**
   * Moves `quantity` from Picked to shipped on the CALLER's QueryRunner
   * (Sprint 4 task §22-§23): Picked - N AND On Hand - N per allocated bin,
   * SN-tracked units -> SHIPPED. The reservation header flips to CONSUMED
   * only when every line's shipped_qty reaches its picked_qty, so a partially
   * shipped reservation stays PICKED and the remainder remains interceptable.
   */
  async shipStockPartialInTx(
    runner: QueryRunner,
    reservationId: string,
    input: {
      quantity: string;
      operator: OperatorContext;
      idempotencyKey: string;
      remark?: string | null;
      /** Required for serial-tracked SKUs; count must match the quantity. */
      serialNumbers?: string[];
    },
  ): Promise<{ reservation: InventoryReservationEntity; idempotentReplay: boolean }> {
    const qty = parseQty(input.quantity);
    if (qty <= 0n) {
      throw new InventoryQuantityInvalidError('出库数量必须大于 0');
    }
    const eventKey = `SHIP:${reservationId}:${input.idempotencyKey}`;
    const raced = await this.ledgerRepo.findEventByIdempotencyKeyTx(runner, eventKey);
    if (raced !== null) {
      const reservation = await this.reservationRepo.lockById(runner, reservationId);
      if (reservation === null) {
        throw new ReservationNotFoundError(reservationId);
      }
      return { reservation, idempotentReplay: true };
    }

    const reservation = await this.reservationRepo.lockById(runner, reservationId);
    if (reservation === null) {
      throw new ReservationNotFoundError(reservationId);
    }
    if (reservation.status !== 'PICKED') {
      throw new InvalidReservationStateError({
        reservationId,
        currentStatus: reservation.status,
        attemptedAction: 'SHIP_PARTIAL',
      });
    }

    const lines = await this.reservationRepo.findLinesLocked(runner, reservationId);
    const orderedLines = await sortLinesByBinCodeOnRunner(runner, lines);
    const serialTracked = await skuSerialTrackedOnRunner(runner, reservation.skuId);

    const lineTakes = new Map<string, bigint>();
    let shippedSerials: InventorySerialEntity[] = [];
    if (serialTracked) {
      const serialNumbers = [...new Set((input.serialNumbers ?? []).map((sn) => sn.trim()))].filter(
        (sn) => sn !== '',
      );
      if (input.serialNumbers === undefined || serialNumbers.length === 0) {
        throw new InventorySerialInvalidError('SN 管理商品出库必须提供 serialNumber 列表', {
          reservationId,
        });
      }
      if (qty % 1000n !== 0n || BigInt(serialNumbers.length) * 1000n !== qty) {
        throw new InventorySerialInvalidError('出库数量与 serialNumber 数量不一致', {
          reservationId,
          quantity: input.quantity,
          serialCount: serialNumbers.length,
        });
      }
      shippedSerials = await this.serialRepo.lockBySerialNumbers(runner, serialNumbers);
      const byNumber = new Map(shippedSerials.map((serial) => [serial.serialNumber, serial]));
      for (const serialNumber of serialNumbers) {
        const serial = byNumber.get(serialNumber);
        if (
          serial === undefined ||
          serial.reservationId !== reservationId ||
          serial.status !== 'PICKED' ||
          serial.skuId !== reservation.skuId
        ) {
          throw new InventorySerialInvalidError('SN 不属于该预约或状态不允许出库', {
            reservationId,
            serialNumber,
          });
        }
      }
      // Serial bins drive the line allocation (one unit per serial).
      const remainingOf = new Map(
        orderedLines.map((line) => [line.id, parseQty(line.pickedQty) - parseQty(line.shippedQty)]),
      );
      for (const serial of shippedSerials) {
        const target = orderedLines.find((line) => line.binId === serial.binId);
        const headroom = target === undefined ? 0n : (remainingOf.get(target.id) ?? 0n);
        if (target === undefined || headroom < 1000n) {
          throw new InventorySerialInvalidError('SN 所在库位与预约拣货行不匹配', {
            reservationId,
            serialNumber: serial.serialNumber,
            binId: serial.binId,
          });
        }
        remainingOf.set(target.id, headroom - 1000n);
        lineTakes.set(target.id, (lineTakes.get(target.id) ?? 0n) + 1000n);
      }
    } else {
      if (input.serialNumbers !== undefined && input.serialNumbers.length > 0) {
        throw new InventorySerialInvalidError('非 SN 管理商品不能提供 serialNumber', {
          reservationId,
        });
      }
      let remaining = qty;
      for (const line of orderedLines) {
        if (remaining === 0n) {
          break;
        }
        const shippable = parseQty(line.pickedQty) - parseQty(line.shippedQty);
        if (shippable <= 0n) {
          continue;
        }
        const take = shippable < remaining ? shippable : remaining;
        lineTakes.set(line.id, take);
        remaining -= take;
      }
      if (remaining > 0n) {
        throw new InvalidReservationStateError({
          reservationId,
          currentStatus: reservation.status,
          attemptedAction: 'SHIP_PARTIAL',
        });
      }
    }

    const ledgerLines: LedgerLineInsert[] = [];
    let allLinesFullyShipped = true;
    for (const line of orderedLines) {
      const take = lineTakes.get(line.id) ?? 0n;
      const lineShippedAfter = parseQty(line.shippedQty) + take;
      if (take === 0n) {
        allLinesFullyShipped =
          allLinesFullyShipped && lineShippedAfter === parseQty(line.pickedQty);
        continue;
      }
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
      const picked = qtyFromDb(balance.pickedQty);
      const patch = {
        onHandQty: formatQty(onHand - take), // Picked - N, On Hand - N (task §34)
        reservedQty: balance.reservedQty,
        pickedQty: formatQty(picked - take),
        version: nextVersionOf(balance),
      };
      assertBalanceInvariants(patch);
      await this.balanceRepo.saveQuantities(runner, balance.id, patch);
      ledgerLines.push({
        skuId: reservation.skuId,
        warehouseId: reservation.warehouseId,
        binId: line.binId,
        transactionType: 'SHIP',
        quantityBefore: balance.onHandQty,
        quantityChange: formatQty(-take),
        quantityAfter: patch.onHandQty,
        reservedBefore: null,
        reservedChange: null,
        reservedAfter: null,
        pickedBefore: balance.pickedQty,
        pickedChange: formatQty(-take),
        pickedAfter: patch.pickedQty,
        remark: `reservation=${reservation.reservationNo}`,
      });

      const fullyShipped = lineShippedAfter === parseQty(line.pickedQty);
      allLinesFullyShipped = allLinesFullyShipped && fullyShipped;
      await this.reservationRepo.updateLine(runner, line.id, {
        shippedQty: formatQty(lineShippedAfter),
        status: fullyShipped ? 'CONSUMED' : 'PICKED',
      });
    }

    if (shippedSerials.length > 0) {
      await this.serialRepo.updateMany(
        runner,
        shippedSerials.map((serial) => serial.id),
        { status: 'SHIPPED' },
      );
    }

    await this.ledgerRepo.insertEventWithLines(
      runner,
      {
        eventType: 'SHIP',
        referenceType: reservation.referenceType,
        referenceId: reservation.referenceId,
        idempotencyKey: eventKey,
        operatorId: input.operator.userId,
        remark: `reservation=${reservation.reservationNo}; partial=${formatQty(qty)}${suffixRemark(input.remark)}`,
      },
      ledgerLines,
    );

    if (allLinesFullyShipped) {
      const headerPatch: Partial<InventoryReservationEntity> = {
        status: 'CONSUMED',
        consumedAt: new Date(),
      };
      await this.reservationRepo.updateStatus(runner, reservationId, headerPatch);
      return { reservation: { ...reservation, ...headerPatch }, idempotentReplay: false };
    }
    return { reservation, idempotentReplay: false };
  }

  // --------------------------------------------------------------------------
  // Interception return-to-stock (Sprint 4 task §37-§40)
  // --------------------------------------------------------------------------

  /**
   * Returns the REMAINING picked units (picked_qty - shipped_qty per line) of
   * a PICKED reservation back to sellable stock on the CALLER's QueryRunner:
   * Picked - N while On Hand NEVER increases - picking never reduced it
   * (task §38). SN-tracked units return to IN_STOCK at the scanned target
   * bin; the reservation ends in RELEASED, never PICKED (task §39).
   */
  async returnPickedStockInTx(
    runner: QueryRunner,
    reservationId: string,
    input: {
      targetBinId: string;
      operator: OperatorContext;
      idempotencyKey: string;
      remark?: string | null;
    },
  ): Promise<{ reservation: InventoryReservationEntity; idempotentReplay: boolean }> {
    const eventKey = `RETURN_PICKED:${reservationId}:${input.idempotencyKey}`;
    const raced = await this.ledgerRepo.findEventByIdempotencyKeyTx(runner, eventKey);
    if (raced !== null) {
      const reservation = await this.reservationRepo.lockById(runner, reservationId);
      if (reservation === null) {
        throw new ReservationNotFoundError(reservationId);
      }
      return { reservation, idempotentReplay: true };
    }

    const reservation = await this.reservationRepo.lockById(runner, reservationId);
    if (reservation === null) {
      throw new ReservationNotFoundError(reservationId);
    }
    if (reservation.status !== 'PICKED') {
      throw new InvalidReservationStateError({
        reservationId,
        currentStatus: reservation.status,
        attemptedAction: 'RETURN_PICKED',
      });
    }

    const lines = await this.reservationRepo.findLinesLocked(runner, reservationId);
    const orderedLines = await sortLinesByBinCodeOnRunner(runner, lines);

    const ledgerLines: LedgerLineInsert[] = [];
    for (const line of orderedLines) {
      const remaining = parseQty(line.pickedQty) - parseQty(line.shippedQty);
      if (remaining <= 0n) {
        continue;
      }
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
      const picked = qtyFromDb(balance.pickedQty);
      const patch = {
        onHandQty: balance.onHandQty, // On Hand unchanged - pick never reduced it
        reservedQty: balance.reservedQty,
        pickedQty: formatQty(picked - remaining),
        version: nextVersionOf(balance),
      };
      assertBalanceInvariants(patch);
      await this.balanceRepo.saveQuantities(runner, balance.id, patch);
      ledgerLines.push({
        skuId: reservation.skuId,
        warehouseId: reservation.warehouseId,
        binId: line.binId,
        transactionType: 'RETURN_PICKED',
        quantityBefore: balance.onHandQty,
        quantityChange: '0.000',
        quantityAfter: patch.onHandQty,
        reservedBefore: null,
        reservedChange: null,
        reservedAfter: null,
        pickedBefore: balance.pickedQty,
        pickedChange: formatQty(-remaining),
        pickedAfter: patch.pickedQty,
        remark: `reservation=${reservation.reservationNo}; bin=${input.targetBinId}`,
      });
      await this.reservationRepo.updateLine(runner, line.id, { status: 'RELEASED' });
    }

    // Every PICKED serial of this reservation returns to IN_STOCK at the
    // scanned target bin, freed of its reservation/picking occupancy - in the
    // SAME transaction as the balance patch (task §40).
    const serials = await this.serialRepo.findByReservationIdTx(runner, reservationId, 'PICKED');
    if (serials.length > 0) {
      await this.serialRepo.updateMany(
        runner,
        serials.map((serial) => serial.id),
        {
          status: 'IN_STOCK',
          binId: input.targetBinId,
          reservationId: null,
          pickingTaskItemId: null,
        },
      );
    }

    if (ledgerLines.length > 0) {
      await this.ledgerRepo.insertEventWithLines(
        runner,
        {
          eventType: 'RETURN_PICKED',
          referenceType: reservation.referenceType,
          referenceId: reservation.referenceId,
          idempotencyKey: eventKey,
          operatorId: input.operator.userId,
          remark: `reservation=${reservation.reservationNo}${suffixRemark(input.remark)}`,
        },
        ledgerLines,
      );
    }

    const headerPatch: Partial<InventoryReservationEntity> = {
      status: 'RELEASED',
      releasedAt: new Date(),
    };
    await this.reservationRepo.updateStatus(runner, reservationId, headerPatch);
    return { reservation: { ...reservation, ...headerPatch }, idempotentReplay: false };
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
        shippedQty: line.shippedQty,
        status: line.status,
      });
    }
    const serials = await this.serialRepo.findByReservationId(reservation.id);
    return {
      serials: serials.map((serial) => ({
        serialNumber: serial.serialNumber,
        status: serial.status,
        pickingTaskItemId: serial.pickingTaskItemId,
      })),
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

/**
 * Whether the SKU is serial-tracked, read on the runner's own connection
 * (master-data lookup inside an open transaction must not use the pool).
 */
async function skuSerialTrackedOnRunner(runner: QueryRunner, skuId: string): Promise<boolean> {
  const rows = (await runner.query(`SELECT serial_tracking FROM skus WHERE id = $1::uuid`, [
    skuId,
  ])) as Array<{ serial_tracking: boolean }>;
  return rows[0]?.serial_tracking === true;
}
