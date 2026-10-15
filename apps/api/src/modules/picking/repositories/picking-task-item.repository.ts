import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { PickingTaskItemEntity } from '../entities/picking-task-item.entity';

/** Data access for picking-task items. */
@Injectable()
export class PickingTaskItemRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insert(
    manager: EntityManager,
    rows: Array<{
      pickingTaskId: string;
      orderId: string;
      orderItemId: string;
      skuId: string;
      reservationId: string;
      requiredQty: string;
    }>,
  ): Promise<PickingTaskItemEntity[]> {
    if (rows.length === 0) {
      return [];
    }
    const repository = manager.getRepository(PickingTaskItemEntity);
    const created = repository.create(
      rows.map((row) => repository.create({ ...row, pickedQty: '0.000', status: 'PENDING' })),
    );
    await repository.insert(created);
    return created;
  }

  async findByTaskId(pickingTaskId: string): Promise<PickingTaskItemEntity[]> {
    return this.dataSource
      .getRepository(PickingTaskItemEntity)
      .find({ where: { pickingTaskId }, order: { createdAt: 'ASC' } });
  }

  async findById(id: string): Promise<PickingTaskItemEntity | null> {
    return this.dataSource.getRepository(PickingTaskItemEntity).findOneBy({ id });
  }

  /** Locks one item FOR UPDATE on the caller's transaction (Sprint 4 P0). */
  async lockById(runner: QueryRunner, id: string): Promise<PickingTaskItemEntity | null> {
    return runner.manager
      .getRepository(PickingTaskItemEntity)
      .createQueryBuilder('i')
      .where('i.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }

  /** Items of an order that sit in a CREATED/IN_PROGRESS task (status port). */
  async countActivePickingItems(orderId: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ cnt: string }>>(
      `SELECT COUNT(*) AS cnt
         FROM picking_task_items i
         JOIN picking_tasks t ON t.id = i.picking_task_id
        WHERE i.order_id = $1::uuid
          AND t.status IN ('CREATED', 'IN_PROGRESS')
          AND i.status = 'PENDING'`,
      [orderId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /** Any picking item of the order with picked_qty > 0 (cancel blocker). */
  /**
   * Cancel blocker: an OPEN (CREATED/IN_PROGRESS) task already moved stock
   * for this order. Completed picking does NOT block - those lines follow
   * the PICKED-cancel interception path (orders.md §8).
   */
  async hasPickedProgress(orderId: string): Promise<boolean> {
    const rows = await this.dataSource.query<unknown[]>(
      `SELECT 1
         FROM picking_task_items i
         JOIN picking_tasks t ON t.id = i.picking_task_id
        WHERE i.order_id = $1::uuid
          AND t.status IN ('CREATED', 'IN_PROGRESS')
          AND i.picked_qty > 0
        LIMIT 1`,
      [orderId],
    );
    return rows.length > 0;
  }

  /**
   * Atomic one-unit increment with the over-pick guard evaluated under the
   * row lock (task §40/§77/§85): concurrent scans serialize here and the
   * loser sees picked_qty + 1 > required_qty -> 0 rows. Runs on the CALLER's
   * QueryRunner so the increment commits atomically with the inventory pick
   * (Sprint 4 P0). Returns the resulting picked_qty, or null when the guard
   * rejected.
   */
  async incrementPickedQtyTx(runner: QueryRunner, itemId: string): Promise<string | null> {
    const result: unknown = await runner.query(
      `UPDATE picking_task_items
          SET picked_qty = picked_qty + 1,
              status = CASE WHEN picked_qty + 1 >= required_qty THEN 'PICKED' ELSE 'PENDING' END,
              updated_at = now()
        WHERE id = $1::uuid
          AND status = 'PENDING'
          AND picked_qty + 1 <= required_qty
        RETURNING picked_qty::text, required_qty::text`,
      [itemId],
    );
    const rows = unwrapReturningRows<{ picked_qty: string; required_qty: string }>(result);
    return rows[0]?.picked_qty ?? null;
  }

  async countPendingOfTask(pickingTaskId: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ cnt: string }>>(
      `SELECT COUNT(*) AS cnt FROM picking_task_items
        WHERE picking_task_id = $1::uuid AND status = 'PENDING'`,
      [pickingTaskId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /**
   * 活跃任务中该订单的零进度行摘除（2026-10-15 合并任务语义）：只删本订单
   * 的行，同任务其他订单的行不受影响。返回删除的行数。
   */
  async deleteZeroProgressItemsOfOrderInTask(
    pickingTaskId: string,
    orderId: string,
  ): Promise<number> {
    const result = await this.dataSource.query<unknown>(
      `DELETE FROM picking_task_items
        WHERE picking_task_id = $1::uuid
          AND order_id = $2::uuid
          AND picked_qty = 0
        RETURNING id`,
      [pickingTaskId, orderId],
    );
    return unwrapReturningRows<{ id: string }>(result).length;
  }

  /** Active (CREATED / IN_PROGRESS) tasks that contain lines of this order. */
  async findActiveTaskIdsOfOrder(orderId: string): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ task_id: string }>>(
      `SELECT DISTINCT t.id AS task_id
         FROM picking_tasks t
         JOIN picking_task_items i ON i.picking_task_id = t.id
        WHERE t.status IN ('CREATED', 'IN_PROGRESS')
          AND i.order_id = $1::uuid`,
      [orderId],
    );
    return rows.map((row) => row.task_id);
  }

  /** Remaining line count of a task (merge-task teardown decision). */
  async countItemsOfTask(pickingTaskId: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ cnt: string }>>(
      `SELECT COUNT(*) AS cnt FROM picking_task_items WHERE picking_task_id = $1::uuid`,
      [pickingTaskId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }
}

/**
 * TypeORM's DataSource.query returns a [rows, affected] tuple for
 * UPDATE/DELETE ... RETURNING (postgres driver), but plain rows for SELECT.
 * Normalize both shapes so RETURNING row access cannot silently read the
 * wrong slot.
 */
function unwrapReturningRows<TRow extends Record<string, unknown>>(result: unknown): Array<TRow> {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as Array<TRow>;
  }
  return (result as Array<TRow>) ?? [];
}
