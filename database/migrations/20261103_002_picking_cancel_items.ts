import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 拣货中被取消（2026-11-03，用户确认口径：**已拣的全部进拦截、剩余不再拣**）。
 *
 * 此前只要有任意扫码进度，订单取消就被整单拒绝（orders.md §8），平台取消后
 * 拣货员继续把剩下的拣完，最后逐行做拦截——大量无效劳动。
 *
 * 现在取消时按行分流：
 * - 未拣行 / 部分拣行 → 状态置 `CANCELLED`，记录本次撤出的数量（`cancelled_qty`）
 *   与原因，并释放未拣余量（库存原语 RELEASE_REMAINDER）；
 * - 已全拣行 → 保持 `PICKED`，走拦截。
 *
 * 行不再物理删除：保留审计（谁、何时、撤了几件），任务进度口径改为
 * 只统计未取消行（`required_qty - cancelled_qty`）。
 */
export class PickingCancelItems1793820000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE picking_task_items
        ADD COLUMN cancelled_qty numeric(18,3) NOT NULL DEFAULT 0,
        ADD COLUMN cancelled_at timestamptz NULL,
        ADD COLUMN cancel_reason varchar(500) NULL
    `);
    // 状态枚举加 CANCELLED（原约束只允许 PENDING / PICKED）。
    await queryRunner.query(`
      ALTER TABLE picking_task_items DROP CONSTRAINT IF EXISTS ck_picking_task_items_status
    `);
    await queryRunner.query(`
      ALTER TABLE picking_task_items
        ADD CONSTRAINT ck_picking_task_items_status
        CHECK (status IN ('PENDING', 'PICKED', 'CANCELLED'))
    `);
    await queryRunner.query(`
      ALTER TABLE picking_task_items
        ADD CONSTRAINT ck_picking_task_items_cancelled_qty
        CHECK (cancelled_qty >= 0 AND picked_qty + cancelled_qty <= required_qty)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE picking_task_items
        DROP CONSTRAINT IF EXISTS ck_picking_task_items_cancelled_qty
    `);
    await queryRunner.query(`
      ALTER TABLE picking_task_items DROP CONSTRAINT IF EXISTS ck_picking_task_items_status
    `);
    await queryRunner.query(`
      ALTER TABLE picking_task_items
        ADD CONSTRAINT ck_picking_task_items_status CHECK (status IN ('PENDING', 'PICKED'))
    `);
    await queryRunner.query(`
      ALTER TABLE picking_task_items
        DROP COLUMN IF EXISTS cancelled_qty,
        DROP COLUMN IF EXISTS cancelled_at,
        DROP COLUMN IF EXISTS cancel_reason
    `);
  }
}
