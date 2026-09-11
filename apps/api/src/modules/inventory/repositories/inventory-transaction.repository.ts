import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { InventoryEventEntity } from '../entities/inventory-event.entity';
import { InventoryTransactionEntity } from '../entities/inventory-transaction.entity';
import {
  InventoryEventType,
  InventoryReferenceType,
  InventoryTransactionType,
} from '../enums/inventory.constants';
import { rawStr } from '../../../common/utils/raw';

export interface LedgerLineInsert {
  skuId: string;
  warehouseId: string;
  binId: string;
  transactionType: InventoryTransactionType;
  quantityBefore: string;
  quantityChange: string;
  quantityAfter: string;
  reservedBefore?: string | null;
  reservedChange?: string | null;
  reservedAfter?: string | null;
  pickedBefore?: string | null;
  pickedChange?: string | null;
  pickedAfter?: string | null;
  remark?: string | null;
}

export interface TransactionListFilters {
  skuId?: string;
  warehouseId?: string;
  binId?: string;
  transactionType?: InventoryTransactionType;
  referenceType?: string;
  referenceId?: string;
  createdFrom?: Date;
  createdTo?: Date;
}

export interface TransactionRowWithRefs {
  transaction: InventoryTransactionEntity;
  skuCode: string;
  warehouseCode: string;
  binCode: string;
  eventNo: string;
  eventType: InventoryEventType;
  operatorName: string | null;
}

/** Ledger data access: events, transaction lines and audit queries. */
@Injectable()
export class InventoryTransactionRepository {
  constructor(private readonly dataSource: DataSource) {}

  async nextEventNo(runner: QueryRunner): Promise<string> {
    const result = (await runner.query(`SELECT nextval('inventory_event_no_seq') AS no`)) as Array<{
      no: string;
    }>;
    return `IEV${result[0]!.no.padStart(8, '0')}`;
  }

  async findEventByIdempotencyKey(key: string): Promise<InventoryEventEntity | null> {
    return this.dataSource.getRepository(InventoryEventEntity).findOneBy({ idempotencyKey: key });
  }

  /** In-transaction re-check AFTER the balance locks are held (task §61). */
  async findEventByIdempotencyKeyTx(
    runner: QueryRunner,
    key: string,
  ): Promise<InventoryEventEntity | null> {
    return runner.manager.getRepository(InventoryEventEntity).findOneBy({ idempotencyKey: key });
  }

  /** Ledger lines of one event (idempotent replay reporting). */
  async findTransactionsByEventId(eventId: string): Promise<InventoryTransactionEntity[]> {
    return this.dataSource
      .getRepository(InventoryTransactionEntity)
      .find({ where: { eventId }, order: { transactionNo: 'ASC' } });
  }

  /** Same read on the caller's transaction (receiveStockInTx replay, Sprint 7). */
  async findTransactionsByEventIdTx(
    runner: QueryRunner,
    eventId: string,
  ): Promise<InventoryTransactionEntity[]> {
    return runner.manager
      .getRepository(InventoryTransactionEntity)
      .find({ where: { eventId }, order: { transactionNo: 'ASC' } });
  }

  /**
   * Inserts one event and its transaction lines (task §18: one business
   * action = one event = one idempotency key). Line idempotency keys are
   * `<event key>#1`, `#2`, ...; transaction_no is `<event_no>-1`, `-2`...
   */
  async insertEventWithLines(
    runner: QueryRunner,
    event: {
      eventType: InventoryEventType;
      referenceType: InventoryReferenceType;
      referenceId: string;
      idempotencyKey: string;
      operatorId: string | null;
      remark: string | null;
    },
    lines: LedgerLineInsert[],
  ): Promise<InventoryEventEntity> {
    const eventNo = await this.nextEventNo(runner);
    const eventRepository = runner.manager.getRepository(InventoryEventEntity);
    const savedEvent = await eventRepository.save(eventRepository.create({ ...event, eventNo }));

    const transactionRepository = runner.manager.getRepository(InventoryTransactionEntity);
    const rows = lines.map((line, index) => {
      const lineNo = index + 1;
      return transactionRepository.create({
        transactionNo: `${eventNo}-${lineNo}`,
        eventId: savedEvent.id,
        skuId: line.skuId,
        warehouseId: line.warehouseId,
        binId: line.binId,
        transactionType: line.transactionType,
        quantityBefore: line.quantityBefore,
        quantityChange: line.quantityChange,
        quantityAfter: line.quantityAfter,
        reservedBefore: line.reservedBefore ?? null,
        reservedChange: line.reservedChange ?? null,
        reservedAfter: line.reservedAfter ?? null,
        pickedBefore: line.pickedBefore ?? null,
        pickedChange: line.pickedChange ?? null,
        pickedAfter: line.pickedAfter ?? null,
        referenceType: event.referenceType,
        referenceId: event.referenceId,
        idempotencyKey: `${event.idempotencyKey}#${lineNo}`,
        operatorId: event.operatorId,
        remark: line.remark ?? event.remark,
      });
    });
    if (rows.length > 0) {
      await transactionRepository.insert(rows);
    }
    return savedEvent;
  }

  async listWithRefs(
    filters: TransactionListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: TransactionRowWithRefs[]; total: number }> {
    const qb = this.dataSource
      .getRepository(InventoryTransactionEntity)
      .createQueryBuilder('t')
      .innerJoin('skus', 'sku', 'sku.id = t.sku_id')
      .innerJoin('warehouses', 'wh', 'wh.id = t.warehouse_id')
      .innerJoin('warehouse_bins', 'bin', 'bin.id = t.bin_id')
      .innerJoin('inventory_events', 'ev', 'ev.id = t.event_id')
      .leftJoin('users', 'usr', 'usr.id = t.operator_id')
      .addSelect('sku.sku_code', 'sku_code')
      .addSelect('wh.warehouse_code', 'warehouse_code')
      .addSelect('bin.bin_code', 'bin_code')
      .addSelect('ev.event_no', 'event_no')
      .addSelect('ev.event_type', 'event_type')
      .addSelect('usr.username', 'operator_name');

    if (filters.skuId !== undefined) {
      qb.andWhere('t.skuId = :skuId', { skuId: filters.skuId });
    }
    if (filters.warehouseId !== undefined) {
      qb.andWhere('t.warehouseId = :warehouseId', { warehouseId: filters.warehouseId });
    }
    if (filters.binId !== undefined) {
      qb.andWhere('t.binId = :binId', { binId: filters.binId });
    }
    if (filters.transactionType !== undefined) {
      qb.andWhere('t.transactionType = :transactionType', {
        transactionType: filters.transactionType,
      });
    }
    if (filters.referenceType !== undefined) {
      qb.andWhere('t.referenceType = :referenceType', { referenceType: filters.referenceType });
    }
    if (filters.referenceId !== undefined) {
      qb.andWhere('t.referenceId = :referenceId', { referenceId: filters.referenceId });
    }
    if (filters.createdFrom !== undefined) {
      qb.andWhere('t.createdAt >= :createdFrom', { createdFrom: filters.createdFrom });
    }
    if (filters.createdTo !== undefined) {
      qb.andWhere('t.createdAt <= :createdTo', { createdTo: filters.createdTo });
    }

    qb.orderBy('t.createdAt', 'DESC')
      .addOrderBy('t.transactionNo', 'DESC')
      .skip(offset)
      .take(limit);
    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;
    const rows: TransactionRowWithRefs[] = entities.map((transaction, index) => ({
      transaction,
      skuCode: rawStr(rawList[index]?.['sku_code']),
      warehouseCode: rawStr(rawList[index]?.['warehouse_code']),
      binCode: rawStr(rawList[index]?.['bin_code']),
      eventNo: rawStr(rawList[index]?.['event_no']),
      eventType: rawStr(rawList[index]?.['event_type']) as InventoryEventType,
      operatorName:
        rawList[index]?.['operator_name'] === null ||
        rawList[index]?.['operator_name'] === undefined
          ? null
          : rawStr(rawList[index]['operator_name']),
    }));
    return { rows, total };
  }
}
