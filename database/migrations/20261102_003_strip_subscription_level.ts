import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 去掉订阅条件里的 `level`（2026-11-02）。
 *
 * 每个通知事件的级别是固定的（买家消息 WARN、退货状态 INFO…），「级别」这个
 * 过滤条件只能是「恒真」或「恒假」：用户选了不匹配的级别，订阅看起来存好了，
 * 实际永远不会触发（实测：wbs 订阅「买家新消息」时选了 INFO，一条投递都没产生）。
 *
 * 代码侧已改为：匹配时忽略 level、接口不再接受 level 条件、UI 不再展示。
 * 这里把存量数据里的 level 键清掉，保留其它条件。
 */
export class StripSubscriptionLevelCondition1793660000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE notification_subscriptions
         SET conditions = conditions - 'level',
             updated_at = now()
       WHERE conditions ? 'level'
    `);
  }

  public async down(): Promise<void> {
    // 一次性清理：level 条件本身无业务含义，无需恢复（见类注释）。
  }
}
