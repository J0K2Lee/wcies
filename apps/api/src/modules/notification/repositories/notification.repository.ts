import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { NotificationChannel, NotificationStatus } from '../enums/notification.constants';
import { NotificationEntity } from '../entities/notification.entity';
export interface NotificationListFilters {
  type?: string;
  channel?: string;
  status?: string;
  referenceType?: string;
  referenceId?: string;
}

/** Data access for notification rows. */
@Injectable()
export class NotificationRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insert(
    manager: EntityManager,
    row: {
      type: string;
      channel: NotificationChannel;
      referenceType: string;
      referenceId: string;
      recipient?: string | null;
      title: string;
      content: string;
      status: NotificationStatus;
      attemptCount?: number;
      sentAt?: Date | null;
    },
  ): Promise<NotificationEntity> {
    const repository = manager.getRepository(NotificationEntity);
    const entity = repository.create({
      ...row,
      recipient: row.recipient ?? null,
      attemptCount: row.attemptCount ?? 0,
      sentAt: row.sentAt ?? null,
    });
    return repository.save(entity);
  }

  async findById(id: string): Promise<NotificationEntity | null> {
    return this.dataSource.getRepository(NotificationEntity).findOneBy({ id });
  }

  async lockById(manager: EntityManager, id: string): Promise<NotificationEntity | null> {
    return manager
      .getRepository(NotificationEntity)
      .createQueryBuilder('n')
      .where('n.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }

  async updateDelivery(
    manager: EntityManager,
    id: string,
    patch: Partial<
      Pick<NotificationEntity, 'status' | 'attemptCount' | 'lastError' | 'sentAt' | 'failedAt'>
    >,
  ): Promise<void> {
    await manager.getRepository(NotificationEntity).update({ id }, patch);
  }

  async list(
    filters: NotificationListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: NotificationEntity[]; total: number }> {
    const qb = this.dataSource.getRepository(NotificationEntity).createQueryBuilder('n');
    if (filters.type !== undefined) {
      qb.andWhere('n.type = :type', { type: filters.type });
    }
    if (filters.channel !== undefined) {
      qb.andWhere('n.channel = :channel', { channel: filters.channel });
    }
    if (filters.status !== undefined) {
      qb.andWhere('n.status = :status', { status: filters.status });
    }
    if (filters.referenceType !== undefined) {
      qb.andWhere('n.referenceType = :referenceType', { referenceType: filters.referenceType });
    }
    if (filters.referenceId !== undefined) {
      qb.andWhere('n.referenceId = :referenceId', { referenceId: filters.referenceId });
    }
    qb.orderBy('n.createdAt', 'DESC').skip(offset).take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return { rows, total };
  }
}
