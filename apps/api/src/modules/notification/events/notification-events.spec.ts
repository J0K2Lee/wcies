import { describe, expect, it } from 'vitest';
import {
  buildFeishuCard,
  conditionsMatch,
  NOTIFICATION_EVENTS,
  NotificationEventData,
} from './notification-events';
import { NOTIFICATION_TYPES } from '../enums/notification.constants';

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
    expect(conditionsMatch({ storeId: ['store-2'] }, data)).toBe(false);
  });

  it('规则里有、payload 没有的字段视为不匹配（不误发）', () => {
    expect(conditionsMatch({ unknownField: ['x'] }, data)).toBe(false);
  });

  it('遗留的 level 条件被忽略（2026-11-02：选错级别导致订阅永不触发）', () => {
    // wbs 实测：订阅「买家消息」(WARN) 时带了 level=['INFO']，此前一条投递都没有。
    expect(
      conditionsMatch({ level: ['INFO'] }, { level: 'WARN', factors: { storeId: 's1' } }),
    ).toBe(true);
    // 其它条件仍然生效（AND 语义不变）。
    expect(
      conditionsMatch(
        { level: ['INFO'], storeId: ['other'] },
        { level: 'WARN', factors: { storeId: 's1' } },
      ),
    ).toBe(false);
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

/**
 * 订阅白名单必须与事件目录同源（2026-11-02 回归）。
 *
 * 背景：`NOTIFICATION_TYPES` 曾是手写的四个事件，新增事件只登记目录、没进
 * 白名单，导致「我的订阅 → 新增订阅」选新事件时 400
 * `eventType must be one of …ORDER_INTERCEPTION_REQUIRED…`。
 */
describe('通知事件目录 ↔ 订阅白名单', () => {
  it('目录里的每个事件都可订阅，且白名单没有多余项', () => {
    const catalog = Object.keys(NOTIFICATION_EVENTS);
    expect(catalog.length).toBeGreaterThan(0);
    expect([...NOTIFICATION_TYPES].sort()).toEqual([...catalog].sort());
  });

  it('买家侧四类提醒在白名单里（用户实测故障点）', () => {
    expect(NOTIFICATION_TYPES).toEqual(
      expect.arrayContaining([
        'BUYER_MESSAGE_RECEIVED',
        'REVIEW_CREATED',
        'RETURN_REQUESTED',
        'RETURN_STATE_CHANGED',
      ]),
    );
  });

  it('每个事件都声明了级别、可过滤字段与站内跳转路径', () => {
    for (const definition of Object.values(NOTIFICATION_EVENTS)) {
      expect(definition.level).toBeTruthy();
      expect(definition.conditionFields.length).toBeGreaterThan(0);
      expect(definition.linkPath.startsWith('/')).toBe(true);
    }
  });
});
