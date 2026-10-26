import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';
import { NotificationService } from '../services/notification.service';

export interface NotificationJobPayload {
  /** 推送投递行 id（事件 × 用户 × 通道）。 */
  deliveryId: string;
}

/**
 * Consumes FEISHU delivery jobs (Sprint 4 task §50-§51). The processor only
 * orchestrates - delivery rules live in NotificationService (AGENTS.md §51).
 * A failed delivery marks the row FAILED (retryable) and never throws the
 * business fact away.
 */
@Processor(QUEUE_NAMES.notification)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly notificationService: NotificationService) {
    super();
  }

  async process(job: Job<NotificationJobPayload>): Promise<string> {
    await this.notificationService.deliver(job.data.deliveryId);
    return `delivered: ${job.data.deliveryId}`;
  }
}
