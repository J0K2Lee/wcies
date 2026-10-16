import { MigrationInterface, QueryRunner } from 'typeorm';

/** pg `INSERT ... RETURNING` 经 TypeORM query() 返回 [rows, rowCount]。 */
function returningRows(result: unknown): unknown[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as unknown[];
  }
  return (result as unknown[]) ?? [];
}

/**
 * 补记状态历史：数据修复迁移曾直接 UPDATE `orders.erp_status`，未写
 * `order_status_history`（AGENTS §39 要求每次 erp_status 变更都留痕）。
 *
 * 涉及两处历史数据修复：
 *  - `20261016_001`（陈旧 EXCEPTION 归位）：ORD00000207 `EXCEPTION → NEW`；
 *  - `20261015_002`（平台已取消死单归位）：ORD00000041 `BACKORDERED → CANCELLED`。
 *
 * 判定口径与「状态机不变式」一致：当前 `erp_status` 与「该单最后一条历史行的
 * to_status」不一致 ⇒ 存在一次未留痕的改写。为每条这样的订单补一行
 * `from = 最后历史 to` → `to = 当前 erp_status`。
 *
 * 幂等：补记后最新历史行的 to_status 恒等于当前 erp_status，重跑匹配 0 行。
 * 这是审计补记，不是业务状态迁移——不改变任何当前的 erp_status。
 */
export class BackfillOrderStatusHistoryForDataFix1793420000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const inserted: unknown[] = await queryRunner.query(
      `WITH latest AS (
         SELECT DISTINCT ON (h.order_id) h.order_id, h.to_status
           FROM order_status_history h
          ORDER BY h.order_id, h.created_at DESC, h.id DESC
       )
       INSERT INTO order_status_history
         (order_id, from_status, to_status, reason, operator_id, operator_name, created_at)
       SELECT o.id, l.to_status, o.erp_status,
              '迁移补记：状态曾由数据修复迁移直接改写，补记历史行（AGENTS §39）',
              NULL, 'migration', now()
         FROM orders o
         JOIN latest l ON l.order_id = o.id
        WHERE l.to_status <> o.erp_status
       RETURNING id`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[migration] backfill_order_status_history_for_data_fix: 补记历史 ${returningRows(inserted).length} 行`,
    );
  }

  public async down(): Promise<void> {
    // 审计补记不回滚：删除历史行会重新制造「状态变更无留痕」，与 AGENTS §39 相悖。
  }
}
