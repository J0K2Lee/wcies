import { DomainError } from '../../../common/errors/domain.error';

/**
 * 导出请求里出现列目录之外的 key（2026-11-04）。
 *
 * 不做「忽略未知列」的兜底：静默丢列会让用户以为导出成功但少了几列数据。
 */
export class InvalidSkuExportColumnError extends DomainError {
  readonly code = 'SKU_EXPORT_INVALID_COLUMNS';
  readonly httpStatus = 422;

  constructor(unknownKeys: readonly string[]) {
    super(`导出列不在可选范围内：${unknownKeys.join('、')}`, { unknownKeys });
  }
}

/** 同一用户同时只能跑一个导出（防止一个人把导出队列占满）。 */
export class SkuExportInProgressError extends DomainError {
  readonly code = 'SKU_EXPORT_IN_PROGRESS';
  readonly httpStatus = 409;

  constructor() {
    super('已有一个导出任务在进行中，请等它完成后再提交', {});
  }
}

/** 导出任务不存在或不属于当前用户。 */
export class SkuExportJobNotFoundError extends DomainError {
  readonly code = 'SKU_EXPORT_JOB_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(jobId: string) {
    super('导出任务不存在或已过期', { jobId });
  }
}
