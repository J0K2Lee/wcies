import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, QueryDeepPartialEntity, Repository } from 'typeorm';
import { ImportJobEntity } from '../entities/import-job.entity';

/** Data access only - no business rules here (AGENTS.md §8). */
@Injectable()
export class ImportJobRepository {
  constructor(
    @InjectRepository(ImportJobEntity)
    private readonly repository: Repository<ImportJobEntity>,
  ) {}

  async findById(id: string): Promise<ImportJobEntity | null> {
    return this.repository.findOneBy({ id });
  }

  async list(
    filters: { importType?: string; status?: string },
    limit: number,
    offset: number,
  ): Promise<{ rows: ImportJobEntity[]; total: number }> {
    const qb = this.repository.createQueryBuilder('job');
    if (filters.importType !== undefined) {
      qb.andWhere('job.import_type = :importType', { importType: filters.importType });
    }
    if (filters.status !== undefined) {
      qb.andWhere('job.status = :status', { status: filters.status });
    }
    qb.orderBy('job.createdAt', 'DESC').skip(offset).take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return { rows, total };
  }

  async insert(job: Partial<ImportJobEntity>): Promise<ImportJobEntity> {
    const created = this.repository.create(job as unknown as DeepPartial<ImportJobEntity>);
    return this.repository.save(created);
  }

  async update(id: string, patch: Partial<ImportJobEntity>): Promise<void> {
    await this.repository.update(
      { id },
      patch as unknown as QueryDeepPartialEntity<ImportJobEntity>,
    );
  }
}
