import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 发货单运单号回填（2026-10-21 用户报告）。
 *
 * 背景：发货单的 `tracking_number` 是创建时从订单 `platform_tracking_no`
 * 复制的一次性快照。OZON 组包后要再过一段时间才会给出运单号字段，而
 * `TYPE_STATE_CHANGED` webhook 不推送 `awaiting_deliver` 这一跳；操作员在
 * 平台回填之前发货，发货单就永久为空（例如 ORD00000414 / SHP00000074）。
 *
 * 代码侧已修（本批）：
 *   - 面单归档后主动回读一次订单事实（面单可取 = 平台已注册）；
 *   - 同步层每次观察到运单号时，把该订单下空运单号的发货单补齐。
 * 本迁移修复既有数据：订单已经有运单号、但发货单仍为空的记录。
 *
 * 只填空值，绝不覆盖人工录入；订单尚无运单号的记录留给后续同步回填。
 */
export class BackfillShipmentTracking1792542000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE shipments s
         SET tracking_number = o.platform_tracking_no,
             updated_at = now()
        FROM orders o
       WHERE s.order_id = o.id
         AND s.tracking_number IS NULL
         AND o.platform_tracking_no IS NOT NULL
         AND o.platform_tracking_no <> ''
    `);
  }

  /** 数据修复不可逆：运单号是平台事实，回退会重新制造空值。 */
  public async down(): Promise<void> {
    // no-op
  }
}
