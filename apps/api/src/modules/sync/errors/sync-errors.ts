import { DomainError } from '../../../common/errors/domain.error';

/** Another sync for the same store + sync type is PENDING/RUNNING (§15/§53). */
export class SyncAlreadyRunningError extends DomainError {
  readonly code = 'SYNC_ALREADY_RUNNING';
  readonly httpStatus = 409;

  constructor(storeId: string, syncType: string, activeJobId: string | null) {
    super(`Store ${storeId} already has an active ${syncType} job`, {
      storeId,
      syncType,
      activeJobId,
    });
  }
}

/** Sync job not found. */
export class SyncJobNotFoundError extends DomainError {
  readonly code = 'SYNC_JOB_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`Sync job not found: ${id}`, { id });
  }
}

/** The store cannot be synced (missing/inactive/unsupported platform). */
export class SyncStoreNotSyncableError extends DomainError {
  readonly code = 'SYNC_STORE_NOT_SYNCABLE';
  readonly httpStatus = 409;

  constructor(storeId: string, reason: string) {
    super(`Store ${storeId} cannot be synced: ${reason}`, { storeId, reason });
  }
}

/**
 * Webhook payload we cannot interpret (2026-10-27).
 *
 * 必须回 **4xx**：平台的推送/探测请求格式问题不是网关故障。此前 OZON 的
 * 连通性探测（body 不带 message_type）会被 mapper 判成畸形并沿用
 * PLATFORM_BAD_RESPONSE 的 502 —— 平台按 SERVER_FAULT 记账，累计后自动
 * 停用了订阅（2026-10-27 实证）。
 */
export class WebhookPayloadInvalidError extends DomainError {
  readonly code = 'WEBHOOK_PAYLOAD_INVALID';
  readonly httpStatus = 422;

  constructor(platform: string, reason: string) {
    super(`Webhook payload rejected by ${platform}: ${reason}`, { platform, reason });
  }
}

/**
 * 平台已取消该订单，且系统已按平台事实完成收敛（2026-10-27）。
 *
 * 组包/取面单路径在平台报错后做定向回读，读到 `cancelled` 时先把事实落库
 * （取消链：释放占用 / 生成拦截 / 通知），再用这个错误告诉操作员「已经自动
 * 处理，不需要再点」。区别于普通 409：消息里说明取消已生效。
 */
export class OrderCancelledOnPlatformError extends DomainError {
  readonly code = 'ORDER_CANCELLED_ON_PLATFORM';
  readonly httpStatus = 409;

  constructor(orderNo: string) {
    super(`平台已取消订单 ${orderNo}；系统已按平台事实转入取消并生成拦截任务`, { orderNo });
  }
}
