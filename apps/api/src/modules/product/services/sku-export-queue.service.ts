import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ObjectStorageService } from '../../../infrastructure/storage/object-storage.service';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';
import { SKU_EXPORT_COLUMN_BY_KEY } from '../constants/sku-export-columns';
import { SkuExportJobCreatedDto, SkuExportJobStatusDto } from '../dto/sku-export.dto';
import {
  InvalidSkuExportColumnError,
  SkuExportInProgressError,
  SkuExportJobNotFoundError,
} from '../errors/sku-export-errors';
import { SkuExportJobData, SkuExportResult } from './sku-export.service';

/** Job name on the `wcies.export` queue. */
export const SKU_EXPORT_JOB = 'SKU_EXPORT';

/** 导出文件签名地址有效期：比默认 15 分钟长，用户拿到链接后可能隔一会儿再点。 */
const DOWNLOAD_URL_TTL_SEC = 1800;

/** 队列里保留多久：完成后 24 小时、失败后 7 天（够排查，不无限增长）。 */
const KEEP_COMPLETED_MS = 24 * 60 * 60 * 1000;
const KEEP_FAILED_MS = 7 * 24 * 60 * 60 * 1000;

interface SkuExportPayload extends SkuExportJobData {
  readonly userId: string | null;
}

/**
 * SKU 导出的队列入口与状态查询（2026-11-04）。
 *
 * 为什么走队列：用户要求**全量**导出、不设行数上限，而 AGENTS §50 明确
 * 「大型文件导出必须进 BullMQ」。任务状态直接读 BullMQ job（Redis），
 * 不新建表 —— 导出是可重放的临时产物，不需要独立状态机。
 */
@Injectable()
export class SkuExportQueueService {
  constructor(
    @InjectQueue(QUEUE_NAMES.export) private readonly queue: Queue,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  async createExport(
    data: SkuExportJobData,
    operator: { userId: string | null },
  ): Promise<SkuExportJobCreatedDto> {
    // 列白名单在入队前校验：非法列应当在提交时得到 422，而不是变成一个
    // 队列里失败的 job（前端只能看到「导出失败」）。服务层仍会再校验一次，
    // 因为 job 也可能被直接投递。
    const unknown = data.columns.filter((key) => !SKU_EXPORT_COLUMN_BY_KEY.has(key));
    if (unknown.length > 0) {
      throw new InvalidSkuExportColumnError(unknown);
    }
    if (data.columns.length === 0) {
      throw new InvalidSkuExportColumnError(['(未选择任何列)']);
    }

    // 单飞：一个人同时只允许一个导出，避免把 worker 占满（并发度本来就低）。
    const pending = await this.queue.getJobs(['active', 'waiting', 'delayed']);
    const mine = pending.some((job) => (job.data as SkuExportPayload).userId === operator.userId);
    if (mine) {
      throw new SkuExportInProgressError();
    }

    const payload: SkuExportPayload = { ...data, userId: operator.userId };
    const job = await this.queue.add(SKU_EXPORT_JOB, payload, {
      attempts: 1,
      removeOnComplete: { age: KEEP_COMPLETED_MS / 1000, count: 200 },
      removeOnFail: { age: KEEP_FAILED_MS / 1000, count: 200 },
    });
    return { jobId: String(job.id), status: 'QUEUED' };
  }

  /**
   * 任务状态。只能查自己提交的任务（导出内容含成本价），查别人的按「不存在」处理，
   * 不区分 403 —— 不给探测他人任务 id 的反馈。
   */
  async getStatus(
    jobId: string,
    operator: { userId: string | null },
  ): Promise<SkuExportJobStatusDto> {
    const job = await this.queue.getJob(jobId);
    if (job === undefined || job === null) {
      throw new SkuExportJobNotFoundError(jobId);
    }
    const payload = job.data as SkuExportPayload;
    if (payload.userId !== operator.userId) {
      throw new SkuExportJobNotFoundError(jobId);
    }

    const state = await job.getState();
    const progress = typeof job.progress === 'number' ? job.progress : 0;

    if (state === 'failed') {
      return {
        jobId,
        status: 'FAILED',
        progress,
        error: job.failedReason ?? '导出失败',
      };
    }
    if (state !== 'completed') {
      return {
        jobId,
        status: state === 'active' ? 'RUNNING' : 'QUEUED',
        progress,
      };
    }

    const result = job.returnvalue as SkuExportResult | null;
    if (result === null || typeof result.objectKey !== 'string') {
      return { jobId, status: 'FAILED', progress, error: '导出结果缺失' };
    }
    return {
      jobId,
      status: 'COMPLETED',
      progress: 100,
      rowCount: result.rowCount,
      fileName: result.fileName,
      downloadUrl: await this.objectStorage.getSignedUrl(result.objectKey, {
        expiresInSec: DOWNLOAD_URL_TTL_SEC,
      }),
    };
  }
}
