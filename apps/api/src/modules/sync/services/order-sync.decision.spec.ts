import { describe, expect, it } from 'vitest';
import { decideOrderHandling } from './order-sync.service';

/**
 * 跨数据源摄入决策（2026-10-24）。
 *
 * 背景：WB 的双源里，统计流水是**销售报表**，不是任务队列。卖家仓的单本该
 * 由装配任务（v3）建单；报表里有、任务里没有，说明它已经装配走/取消了。
 * 这类行只能更新已有订单，不能建单，否则会得到一张只有订单 UID、平台后台
 * 搜不到、也无法操作的幽灵单（实证 3 张，2026-10-24）。
 */
describe('decideOrderHandling', () => {
  it('报表行没有对应订单 → 跳过（绝不建单）', () => {
    expect(
      decideOrderHandling({ platformOrderId: 'eAD.abc.0.0', ingestPolicy: 'UPDATE_ONLY' }, null),
    ).toBe('SKIP');
  });

  it('报表行命中已有订单（按 srid 或 rid）→ 只更新事实', () => {
    expect(
      decideOrderHandling(
        { platformOrderId: 'eAD.abc.0.0', ingestPolicy: 'UPDATE_ONLY' },
        {
          orderId: 'order-1',
          matchedBy: 'eAD.abc.0.0',
        },
      ),
    ).toBe('UPDATE_FACTS');
    expect(
      decideOrderHandling(
        { platformOrderId: 'eAD.abc.0.0', ingestPolicy: 'UPDATE_ONLY' },
        {
          orderId: 'order-1',
          matchedBy: '6092350637',
        },
      ),
    ).toBe('UPDATE_FACTS');
  });

  it('作业单源（v3）没有对应订单 → 建单', () => {
    expect(decideOrderHandling({ platformOrderId: '6092350637' }, null)).toBe('INGEST');
  });

  it('作业单源已有同 ID 订单 → 走既有的比较-更新路径', () => {
    expect(
      decideOrderHandling(
        { platformOrderId: '6092350637', ingestPolicy: 'CREATE_OR_UPDATE' },
        {
          orderId: 'order-1',
          matchedBy: '6092350637',
        },
      ),
    ).toBe('INGEST');
  });

  it('另一数据源先建过同一张单（命中别名 rid/srid）→ 只更新事实，不建第二张', () => {
    expect(
      decideOrderHandling(
        { platformOrderId: '6092350637', ingestPolicy: 'CREATE_OR_UPDATE' },
        {
          orderId: 'order-1',
          matchedBy: 'eBH.i5bb6dba9b335bbce96ac43acba0842fc.0.0',
        },
      ),
    ).toBe('UPDATE_FACTS');
  });
});
