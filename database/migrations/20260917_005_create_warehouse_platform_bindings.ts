import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * 仓库绑定平台仓库（用户指示 2026-09-17，取代店仓绑定模型）：
 * 内部仓库 1:N 平台仓库（如 OZON warehouse_id 1020005000770362），
 * 平台仓库归属具体店铺（Store），因此同一物理仓库可服务多店铺。
 *
 * 历史数据迁移（规则 89）：仅搬运已登记 platform_warehouse_id 的店仓绑定行
 * ——新模型的唯一事实就是"仓库 + 平台仓库"，未登记平台仓库 ID 的旧绑定行
 * 在新模型中没有对应物，不静默改写（歧义数据宁缺毋滥）。
 */
export class CreateWarehousePlatformBindings1790000800005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'warehouse_platform_bindings',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'warehouse_id', type: 'uuid', isNullable: false },
          { name: 'store_id', type: 'uuid', isNullable: false },
          { name: 'platform_warehouse_id', type: 'varchar', length: 64, isNullable: false },
          { name: 'platform_warehouse_name', type: 'varchar', length: 255, isNullable: true },
          { name: 'fulfillment_mode', type: 'varchar', length: 50, isNullable: false },
          { name: 'remark_name', type: 'varchar', length: 255, isNullable: true },
          { name: 'priority', type: 'integer', isNullable: false, default: '100' },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'ACTIVE'` },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        foreignKeys: [
          {
            name: 'fk_wpb_warehouse',
            columnNames: ['warehouse_id'],
            referencedTableName: 'warehouses',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_wpb_store',
            columnNames: ['store_id'],
            referencedTableName: 'stores',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    // 平台仓库 ID 只能绑定到至多一个内部仓库（同店铺维度唯一）。
    await queryRunner.createIndex(
      'warehouse_platform_bindings',
      new TableIndex({
        name: 'uq_wpb_store_platform_wh',
        columnNames: ['store_id', 'platform_warehouse_id'],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      'warehouse_platform_bindings',
      new TableIndex({ name: 'idx_wpb_warehouse', columnNames: ['warehouse_id'] }),
    );

    // ---- 数据迁移：搬运有平台仓库 ID 的旧店仓绑定（先查重，歧义报错） ----
    const duplicates: Array<Record<string, unknown>> = await queryRunner.query(
      `SELECT store_id, platform_warehouse_id, COUNT(*) AS n
         FROM store_warehouse_bindings
        WHERE platform_warehouse_id IS NOT NULL AND platform_warehouse_id <> ''
        GROUP BY store_id, platform_warehouse_id
       HAVING COUNT(*) > 1`,
    );
    if (duplicates.length > 0) {
      throw new Error(
        `store_warehouse_bindings 中存在同店铺同平台仓库 ID 的重复绑定 ${duplicates.length} 组，拒绝静默迁移`,
      );
    }
    const migrated = await queryRunner.query(
      `INSERT INTO warehouse_platform_bindings
            (warehouse_id, store_id, platform_warehouse_id, platform_warehouse_name,
             fulfillment_mode, priority, status, created_at, updated_at)
       SELECT b.warehouse_id, b.store_id, b.platform_warehouse_id, NULL,
              b.fulfillment_mode, b.priority, b.status, b.created_at, b.updated_at
         FROM store_warehouse_bindings b
        WHERE b.platform_warehouse_id IS NOT NULL AND b.platform_warehouse_id <> ''
        RETURNING id`,
    );
    // 迁移结果记录在案（迁移日志），不静默。
    // eslint-disable-next-line no-console
    console.log(
      `[migration] warehouse_platform_bindings: 迁移 ${migrated.length} 行旧店仓绑定（含平台仓库 ID）`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('warehouse_platform_bindings');
  }
}
