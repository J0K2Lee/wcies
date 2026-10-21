import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { ShippingLabelService } from '../../shipment/services/shipping-label.service';
import { ShippingLabelPurgeCursor } from '../../shipment/shipping-label.types';

const SYSTEM_OPERATOR: OperatorContext = { userId: null, username: 'system' };

interface LabelSettings {
  purgeBatchSize: number;
  purgeMaxBatchesPerRun: number;
  purgeMaxRunMs: number;
  purgeGraceMinutes: number;
}

export interface LabelPurgeSweepResult {
  batches: number;
  scanned: number;
  purged: number;
  failed: number;
  /** 最后一个批次是否仍满额（true = 可能还有积压，下一轮继续）。 */
  backlogContinues: boolean;
  elapsedMs: number;
}

/**
 * 终态面单清理（用户指示 2026-10-21）。
 *
 * 只清理**订单已终态**（CANCELLED，或 SHIPPED + platform_stage DELIVERED =
 * 列表的 COMPLETED）的面单字节；行保留为审计事实。
 *
 * 为什么不挂在状态迁移上：终态判定发生在 order 模块（而面单属于 shipment，
 * 反向依赖会破坏模块方向）；COMPLETED 是派生口径、没有单一变更事件；并且
 * S3 删除不是事务性的。扫描天然覆盖手工取消、平台取消与历史积压。
 *
 * 每轮按 `(created_at, id)` keyset 游标循环若干批，直到排空 / 达到批次数或
 * 时间预算。游标保证「本轮删除失败的行」不会在原地反复被选中、卡住后续行。
 * 默认 6 小时跑一次——清理对用户不可见，时效要求极低。
 */
@Injectable()
export class ShippingLabelPurgeService {
  constructor(
    private readonly labelService: ShippingLabelService,
    private readonly config: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  private get settings(): LabelSettings {
    return this.config.getOrThrow<LabelSettings>('app.label');
  }

  async sweep(): Promise<LabelPurgeSweepResult> {
    const settings = this.settings;
    const startedAt = Date.now();
    let cursor: ShippingLabelPurgeCursor | null = null;
    let batches = 0;
    let scanned = 0;
    let purged = 0;
    let failed = 0;
    let lastBatchFull = false;

    for (let batch = 0; batch < settings.purgeMaxBatchesPerRun; batch += 1) {
      const rows = await this.labelService.findPurgeCandidates({
        limit: settings.purgeBatchSize,
        graceMinutes: settings.purgeGraceMinutes,
        after: cursor,
      });
      if (rows.length === 0) {
        lastBatchFull = false;
        break;
      }
      batches += 1;
      scanned += rows.length;
      lastBatchFull = rows.length === settings.purgeBatchSize;

      for (const row of rows) {
        try {
          if (await this.labelService.purgeLabel(row, SYSTEM_OPERATOR)) {
            purged += 1;
          }
        } catch (error: unknown) {
          failed += 1;
          this.logger.warn(
            `shipping label purge failed label=${row.id} order=${
              row.fileName
            }: ${error instanceof Error ? error.message : String(error)}`,
            'ShippingLabelPurgeService',
          );
        }
      }

      const last = rows[rows.length - 1];
      if (last !== undefined) {
        cursor = { createdAt: last.createdAt, id: last.id };
      }
      if (Date.now() - startedAt >= settings.purgeMaxRunMs) {
        break;
      }
    }

    const result: LabelPurgeSweepResult = {
      batches,
      scanned,
      purged,
      failed,
      backlogContinues: lastBatchFull,
      elapsedMs: Date.now() - startedAt,
    };
    this.logger.log(
      `shipping label purge sweep batches=${result.batches} scanned=${result.scanned} purged=${result.purged} failed=${result.failed} backlog=${result.backlogContinues} elapsedMs=${result.elapsedMs}`,
      'ShippingLabelPurgeService',
    );
    return result;
  }
}
