/**
 * 通知事件目录（2026-10-26）。
 *
 * 事件 = 事实（发生了什么），订阅 = 谁想知道（见 notification_subscriptions）。
 * 目录只声明**能被订阅和展示的东西**：级别、可过滤字段、卡片布局、去重键。
 * 用户明确「事件目录暂时无，有需求再提」——所以这里只收录系统里真实存在的
 * 两类拦截事件；未来新增事件只需在此登记，订阅与投递逻辑不用改。
 */

export type NotificationLevel = 'INFO' | 'WARN' | 'HIGH';

/** 发布方向通知模块提交的结构化事件数据。 */
export interface NotificationEventData {
  type: string;
  title: string;
  level: NotificationLevel;
  /** 结构化字段：条件匹配 + 卡片展示共用（值统一转成字符串）。 */
  factors: Record<string, string>;
  /** 正文行（站内展示 / 卡片兜底）。 */
  lines: string[];
  /** 站内处理入口（相对路径）。 */
  linkPath: string;
  /** 去重键：同类型 + 同键在窗口内只记一条。 */
  dedupeKey: string | null;
  referenceType: string;
  referenceId: string;
}

export interface NotificationEventDefinition {
  type: string;
  label: string;
  level: NotificationLevel;
  /** 允许订阅者按哪些字段过滤（订阅 UI 只展示这些）。 */
  conditionFields: Array<{ key: string; label: string }>;
  /** 卡片里按顺序展示的字段。 */
  cardFields: string[];
  /** 站内处理入口（卡片按钮跳转）。 */
  linkPath: string;
}

const INTERCEPTION_FIELDS = [
  { key: 'storeId', label: '店铺' },
  { key: 'warehouseCode', label: '仓库' },
  { key: 'skuCode', label: 'SKU' },
];

export const NOTIFICATION_EVENTS: Record<string, NotificationEventDefinition> = {
  ORDER_INTERCEPTION_REQUIRED: {
    type: 'ORDER_INTERCEPTION_REQUIRED',
    label: '需要拦截',
    level: 'WARN',
    conditionFields: INTERCEPTION_FIELDS,
    cardFields: ['interceptionNo', 'skuCode', 'warehouseCode', 'remainingQty'],
    linkPath: '/interceptions',
  },
  STORE_CREDENTIAL_EXPIRING: {
    type: 'STORE_CREDENTIAL_EXPIRING',
    label: 'API Key 即将到期',
    level: 'WARN',
    conditionFields: [
      { key: 'storeId', label: '店铺' },
      { key: 'platform', label: '平台' },
      { key: 'credentialType', label: '凭证类型' },
    ],
    cardFields: ['storeCode', 'credentialType', 'expiresOn', 'daysLeft'],
    linkPath: '/stores',
  },
  STORE_CREDENTIAL_EXPIRED: {
    type: 'STORE_CREDENTIAL_EXPIRED',
    label: 'API Key 已过期',
    level: 'HIGH',
    conditionFields: [
      { key: 'storeId', label: '店铺' },
      { key: 'platform', label: '平台' },
      { key: 'credentialType', label: '凭证类型' },
    ],
    cardFields: ['storeCode', 'credentialType', 'expiresOn'],
    linkPath: '/stores',
  },
  ORDER_INTERCEPTION_FAILED: {
    type: 'ORDER_INTERCEPTION_FAILED',
    label: '拦截失败',
    level: 'HIGH',
    conditionFields: [...INTERCEPTION_FIELDS, { key: 'interceptionNo', label: '拦截任务' }],
    cardFields: ['interceptionNo', 'orderNo', 'reason'],
    linkPath: '/interceptions',
  },
  /**
   * Webhook 订阅健康（2026-10-27）：平台暂停了本店回调订阅，或平台体检报错。
   * 推送属于「系统健康」类，订阅者可只盯某几家店（storeId / platform）。
   */
  STORE_WEBHOOK_PAUSED: {
    type: 'STORE_WEBHOOK_PAUSED',
    label: 'Webhook 订阅被暂停',
    level: 'HIGH',
    conditionFields: [
      { key: 'storeId', label: '店铺' },
      { key: 'platform', label: '平台' },
    ],
    cardFields: ['storeCode', 'platform', 'reason'],
    linkPath: '/stores',
  },
  STORE_WEBHOOK_UNHEALTHY: {
    type: 'STORE_WEBHOOK_UNHEALTHY',
    label: 'Webhook 体检异常',
    level: 'WARN',
    conditionFields: [
      { key: 'storeId', label: '店铺' },
      { key: 'platform', label: '平台' },
    ],
    cardFields: ['storeCode', 'platform', 'reason'],
    linkPath: '/stores',
  },

  /**
   * 买家侧提醒（2026-11-02）：买家会话有新消息 / 新差评 / 新退货申请 /
   * 退货状态变化。四个事件都按店铺+平台过滤，运营只订阅自己盯的店。
   *
   * 聊天与退货按「会话/退货单」聚合，不按单条消息发——买家连发十条只提醒一次。
   */
  BUYER_MESSAGE_RECEIVED: {
    type: 'BUYER_MESSAGE_RECEIVED',
    label: '买家新消息',
    level: 'WARN',
    conditionFields: [
      { key: 'storeId', label: '店铺' },
      { key: 'platform', label: '平台' },
    ],
    cardFields: ['storeCode', 'orderNumber', 'excerpt', 'messageCount', 'receivedAt'],
    linkPath: '/orders',
  },
  REVIEW_CREATED: {
    type: 'REVIEW_CREATED',
    label: '新差评（1-3 星）',
    level: 'WARN',
    conditionFields: [
      { key: 'storeId', label: '店铺' },
      { key: 'platform', label: '平台' },
    ],
    cardFields: ['storeCode', 'rating', 'excerpt', 'publishedAt'],
    linkPath: '/skus',
  },
  BUYER_QUESTION_RECEIVED: {
    type: 'BUYER_QUESTION_RECEIVED',
    label: '买家提问',
    level: 'WARN',
    conditionFields: [
      { key: 'storeId', label: '店铺' },
      { key: 'platform', label: '平台' },
    ],
    cardFields: ['storeCode', 'platform', 'skuCode', 'excerpt', 'askedAt'],
    linkPath: '/skus',
  },
  RETURN_REQUESTED: {
    type: 'RETURN_REQUESTED',
    label: '新退货申请',
    level: 'WARN',
    conditionFields: [
      { key: 'storeId', label: '店铺' },
      { key: 'platform', label: '平台' },
    ],
    cardFields: ['storeCode', 'orderNo', 'returnNo', 'state', 'quantity'],
    linkPath: '/warehouse-ops?tab=returns',
  },
  RETURN_STATE_CHANGED: {
    type: 'RETURN_STATE_CHANGED',
    label: '退货状态变化',
    level: 'INFO',
    conditionFields: [
      { key: 'storeId', label: '店铺' },
      { key: 'platform', label: '平台' },
    ],
    cardFields: ['storeCode', 'orderNo', 'returnNo', 'state', 'quantity'],
    linkPath: '/warehouse-ops?tab=returns',
  },
};

/** 未登记的事件也能发（级别沿用发布方声明），只是没有专用卡片布局。 */
export function eventDefinition(type: string): NotificationEventDefinition {
  return (
    NOTIFICATION_EVENTS[type] ?? {
      type,
      label: type,
      level: 'WARN',
      conditionFields: [],
      cardFields: [],
      linkPath: '/notifications',
    }
  );
}

/**
 * 条件匹配：**所有键 AND**；每个键的值是候选集合，payload 字段命中任一即满足。
 * 规则里有、payload 没有的字段视为不匹配（保守，不误发）。
 */
export function conditionsMatch(
  conditions: Record<string, string[]> | null | undefined,
  data: Pick<NotificationEventData, 'level' | 'factors'>,
): boolean {
  const entries = Object.entries(conditions ?? {});
  if (entries.length === 0) {
    return true;
  }
  for (const [key, allowed] of entries) {
    if (!Array.isArray(allowed) || allowed.length === 0) {
      continue;
    }
    // `level` 过滤器已废弃（2026-11-02）：每个事件级别是固定的，选了不匹配的
    // 级别等于永远收不到——WB 用户实测「订阅了买家消息却没有投递」就是它。
    // 存量条件里的 level 在这里直接忽略，老订阅立刻恢复。
    if (key === 'level') {
      continue;
    }
    const actual = data.factors[key];
    if (actual === undefined || actual === '' || !allowed.includes(actual)) {
      return false;
    }
  }
  return true;
}

const LEVEL_TEMPLATE: Record<NotificationLevel, string> = {
  HIGH: 'red',
  WARN: 'orange',
  INFO: 'blue',
};

/**
 * 飞书交互卡片（schema 2.0）。
 *
 * 注意（2026-10-26 实测）：schema 2.0 **不支持** `tag: "action"`，按钮必须放在
 * `column_set > column > elements`，否则飞书返回 230099/200861 unsupported tag。
 */
export function buildFeishuCard(
  data: NotificationEventData,
  options: { webBaseUrl: string | null },
): Record<string, unknown> {
  const definition = eventDefinition(data.type);
  const link =
    options.webBaseUrl === null || options.webBaseUrl === ''
      ? null
      : `${options.webBaseUrl.replace(/\/$/, '')}${data.linkPath}`;

  const elements: Array<Record<string, unknown>> = [
    { tag: 'div', text: { tag: 'lark_md', content: data.lines.join('\n') } },
  ];
  if (link !== null) {
    elements.push({
      tag: 'column_set',
      columns: [
        {
          tag: 'column',
          width: 'auto',
          elements: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '去处理' },
              type: 'primary',
              url: link,
            },
          ],
        },
      ],
    });
  }
  return {
    schema: '2.0',
    header: {
      template: LEVEL_TEMPLATE[data.level] ?? LEVEL_TEMPLATE[definition.level],
      title: { tag: 'plain_text', content: data.title },
    },
    body: { elements },
  };
}
