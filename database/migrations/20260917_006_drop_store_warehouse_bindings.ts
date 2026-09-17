import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 移除店仓绑定（用户指示 2026-09-17）：绑定语义由 warehouse_platform_bindings
 * （仓库绑定平台仓库）承接。本迁移在 005 完成数据搬运之后执行；
 * down 不重建旧表数据（仅还原表结构以保持回滚链完整）。
 */
export class DropStoreWarehouseBindings1790000800006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('store_warehouse_bindings');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS store_warehouse_bindings (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         store_id uuid NOT NULL,
         warehouse_id uuid NOT NULL,
         fulfillment_mode varchar(50) NOT NULL,
         platform_warehouse_id varchar(255),
         is_inventory_source boolean NOT NULL DEFAULT true,
         is_inventory_push_enabled boolean NOT NULL DEFAULT false,
         priority integer NOT NULL DEFAULT 100,
         settings jsonb,
         status varchar(30) NOT NULL DEFAULT 'ACTIVE',
         created_at timestamptz NOT NULL DEFAULT now(),
         updated_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_swb_store ON store_warehouse_bindings (store_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_swb_warehouse ON store_warehouse_bindings (warehouse_id)`,
    );
  }
}
