import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { SystemSettingRepository } from '../repositories/system-setting.repository';

/** 订单平台事实回读的分阶段阈值（小时）。 */
export interface OrderFallbackHours {
  /** 平台阶段 AWAITING_SHIPMENT：随时可能被取消，读得最勤。 */
  awaitingShipment: number;
  /** IN_TRANSIT：物流停滞判定需要观察，但不必高频。 */
  inTransit: number;
  /** DELIVERED 且 ERP 未终态（差异收敛）。 */
  delivered: number;
}

export const DEFAULT_ORDER_FALLBACK_HOURS: OrderFallbackHours = {
  awaitingShipment: 2,
  inTransit: 12,
  delivered: 24,
};

const KEY_ORDER_FALLBACK = 'order.platformFallbackHours';
const MIN_HOURS = 0.1;
const MAX_HOURS = 24 * 30;

/**
 * 系统运行参数（2026-10-27，用户要求「回读频率要有 UI」）。
 *
 * 默认值写在代码里；表里只保存运营改过的覆盖值，读取时合并。任何非法/越界
 * 值都回落到默认——系统参数不能因为一次误填让同步停摆。
 */
@Injectable()
export class SystemSettingsService {
  constructor(
    private readonly repository: SystemSettingRepository,
    private readonly operationLog: OperationLogService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 生效值 = 表里运营改过的覆盖值 > ENV 基线 > 代码默认值。
   *
   * ENV（`ORDER_STATE_FALLBACK_HOURS`）只在显式设置时作为**三档统一**的
   * 基线：既有部署与集成测试依赖它（测试用 29 秒窗口验证轮转），不能在
   * 引入分档后把它架空。
   */
  async getOrderFallbackHours(): Promise<OrderFallbackHours> {
    const row = await this.repository.find(KEY_ORDER_FALLBACK);
    return mergeHours(this.baselineHours(), row?.value ?? null);
  }

  private baselineHours(): OrderFallbackHours {
    const envHours = this.config.get<number | null>('app.orderStateFallbackHours');
    if (typeof envHours !== 'number' || !Number.isFinite(envHours) || envHours <= 0) {
      return { ...DEFAULT_ORDER_FALLBACK_HOURS };
    }
    return { awaitingShipment: envHours, inTransit: envHours, delivered: envHours };
  }

  async updateOrderFallbackHours(
    patch: Partial<OrderFallbackHours>,
    operator: OperatorContext,
  ): Promise<OrderFallbackHours> {
    const current = await this.getOrderFallbackHours();
    const next = mergeHours(current, patch);
    await this.repository.upsert(KEY_ORDER_FALLBACK, { ...next }, operator.userId);
    await this.operationLog.record({
      entityType: 'SYSTEM_SETTING',
      entityId: settingEntityId(KEY_ORDER_FALLBACK),
      entityCode: KEY_ORDER_FALLBACK,
      action: 'UPDATE',
      changes: {
        awaitingShipment: { from: current.awaitingShipment, to: next.awaitingShipment },
        inTransit: { from: current.inTransit, to: next.inTransit },
        delivered: { from: current.delivered, to: next.delivered },
      },
      operator,
    });
    return next;
  }
}

/** 合并 + 逐项校验；非法值保留原值（不静默改成别的频率）。 */
function mergeHours(base: OrderFallbackHours, raw: unknown): OrderFallbackHours {
  if (typeof raw !== 'object' || raw === null) {
    return { ...base };
  }
  const source = raw as Record<string, unknown>;
  const pick = (key: keyof OrderFallbackHours): number => {
    const value = source[key];
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < MIN_HOURS || parsed > MAX_HOURS) {
      return base[key];
    }
    return Math.round(parsed * 100) / 100;
  };
  return {
    awaitingShipment: pick('awaitingShipment'),
    inTransit: pick('inTransit'),
    delivered: pick('delivered'),
  };
}

/** 参数键 → 稳定 UUID（operation_logs.entity_id 是 uuid 列）。 */
function settingEntityId(key: string): string {
  const hash = createHash('sha1').update(`system_setting:${key}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
