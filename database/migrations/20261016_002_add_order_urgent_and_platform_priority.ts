import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * 加急订单 + 平台分配优先级（用户指示 2026-10-16，ADR 0022）。
 *
 * 两张表各加一列，支撑「加急优先展示 + 平台>发货时限优先分配」：
 *
 * 1. `orders.is_urgent` —— 加急标记（业务人工标注，默认 false）。它是订单
 *    自身属性，NOT an ERP status（AGENTS.md §38）：不进 erp_status，不参与
 *    状态机，只影响列表置顶与库存分配排序。`urgent_marked_at` 记录最近一次
 *    标记加急的时间（审计；取消加急后保留最后标记时间，任务书要求可追溯）。
 *
 * 2. `platforms.priority` —— 平台之间的分配优先级（用户可设，数值小=优先，
 *    与 `warehouse_platform_bindings.priority` 同向）。种子三平台同值 100，
 *    用户再按业务排序。仅用于缺货到货后的候选行排序，不影响任何状态机。
 */
export class AddOrderUrgentAndPlatformPriority1793410000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'orders',
      new TableColumn({
        name: 'is_urgent',
        type: 'boolean',
        isNullable: false,
        default: false,
      }),
    );
    await queryRunner.addColumn(
      'orders',
      new TableColumn({
        name: 'urgent_marked_at',
        type: 'timestamptz',
        isNullable: true,
      }),
    );
    // 列表置顶 / 缺货分配排序都会按 is_urgent 过滤或排序：部分索引只覆盖
    // 加急行（数量远小于全表），命中成本与表规模无关。
    await queryRunner.query(
      `CREATE INDEX idx_orders_is_urgent ON orders (is_urgent) WHERE is_urgent = true`,
    );

    await queryRunner.addColumn(
      'platforms',
      new TableColumn({
        name: 'priority',
        type: 'integer',
        isNullable: false,
        default: 100,
      }),
    );

    // 缺货到货自动重分配新增「店铺绑定收货仓」半连接过滤
    // (OrderItemRepository.findUnallocatedItemIdsBySku)：按 (store_id,
    // warehouse_id) 命中。既有索引只有单列 warehouse_id，补复合索引。
    await queryRunner.query(
      `CREATE INDEX idx_wpb_store_warehouse ON warehouse_platform_bindings (store_id, warehouse_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_wpb_store_warehouse`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_orders_is_urgent`);
    await queryRunner.dropColumn('orders', 'urgent_marked_at');
    await queryRunner.dropColumn('orders', 'is_urgent');
    await queryRunner.dropColumn('platforms', 'priority');
  }
}
