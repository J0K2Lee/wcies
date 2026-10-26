import { describe, expect, it } from 'vitest';
import { buildFeishuCard, conditionsMatch, NotificationEventData } from './notification-events';

/**
 * 订阅条件与卡片（2026-10-26）。
 *
 * 条件语义：所有键 AND；值为候选集合，命中任一即可；payload 缺字段 = 不匹配。
 * 卡片：飞书 schema 2.0 —— 实测不支持 `tag: action`，按钮必须在 column_set 里。
 */
const data: NotificationEventData = {
  type: 'ORDER_INTERCEPTION_FAILED',
  title: '拦截失败：ITC00000002',
  level: 'HIGH',
  factors: { storeId: 'store-1', warehouseCode: 'ZG-01', skuCode: 'SKU000012006' },
  lines: ['拦截任务 ITC00000002 失败', '订单：ORD00000728'],
  linkPath: '/interceptions',
  dedupeKey: 'interception:itc-1:failed',
  referenceType: 'ORDER_INTERCEPTION',
  referenceId: 'itc-1',
};

describe('conditionsMatch', () => {
  it('空条件 = 全收', () => {
    expect(conditionsMatch({}, data)).toBe(true);
  });

  it('值命中任一即满足', () => {
    expect(conditionsMatch({ storeId: ['other', 'store-1'] }, data)).toBe(true);
    expect(conditionsMatch({ level: ['HIGH', 'WARN'] }, data)).toBe(true);
  });

  it('任一键不命中即整体不命中（AND）', () => {
    expect(conditionsMatch({ storeId: ['store-1'], warehouseCode: ['ZG-02'] }, data)).toBe(false);
    expect(conditionsMatch({ level: ['WARN'] }, data)).toBe(false);
  });

  it('规则里有、payload 没有的字段视为不匹配（不误发）', () => {
    expect(conditionsMatch({ unknownField: ['x'] }, data)).toBe(false);
  });
});

describe('buildFeishuCard（schema 2.0）', () => {
  it('按级别给标题配色，正文包含事件行', () => {
    const card = buildFeishuCard(data, { webBaseUrl: 'https://wcies.example.com' });
    expect((card['header'] as { template: string }).template).toBe('red');
    expect(JSON.stringify(card)).toContain('拦截任务 ITC00000002 失败');
  });

  it('按钮放在 column_set 里（schema 2.0 不支持 tag:action）', () => {
    const card = buildFeishuCard(data, { webBaseUrl: 'https://wcies.example.com/' });
    const elements = (card['body'] as { elements: Array<Record<string, unknown>> }).elements;
    const actions = elements.find((element) => element['tag'] === 'column_set');
    expect(actions).toBeDefined();
    expect(JSON.stringify(actions)).toContain('https://wcies.example.com/interceptions');
    expect(elements.some((element) => element['tag'] === 'action')).toBe(false);
  });

  it('没有 webBaseUrl 时不出按钮', () => {
    const card = buildFeishuCard(data, { webBaseUrl: null });
    const elements = (card['body'] as { elements: Array<Record<string, unknown>> }).elements;
    expect(elements.some((element) => element['tag'] === 'column_set')).toBe(false);
  });
});
