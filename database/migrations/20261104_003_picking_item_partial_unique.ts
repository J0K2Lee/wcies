import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 拣货行唯一约束改为「部分唯一」（2026-11-04 线上 500 修复）。
 *
 * 2026-11-03 起取消拣货/撤行不再物理删除行，而是保留 CANCELLED 审计行。
 * 原来的 `UNIQUE(order_item_id)` 不认识状态：订单行重新分配（再次 RESERVED）
 * 后重新生成拣货任务时，插入撞上历史 CANCELLED 行 → 500
 * `duplicate key value violates unique constraint "uq_picking_task_items_order_item"`
 * （用户实测：批量生成拣货单报 Common database error）。
 *
 * 改成部分唯一索引：同一订单行只允许一条「非 CANCELLED」拣货行，
 * 撤出审计行不再参与约束。
 */
export class PickingItemPartialUnique1794000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE picking_task_items
        DROP CONSTRAINT IF EXISTS uq_picking_task_items_order_item
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_picking_task_items_order_item_active
        ON picking_task_items (order_item_id)
        WHERE status <> 'CANCELLED'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_picking_task_items_order_item_active
    `);
    await queryRunner.query(`
      ALTER TABLE picking_task_items
        ADD CONSTRAINT uq_picking_task_items_order_item UNIQUE (order_item_id)
    `);
  }
}
