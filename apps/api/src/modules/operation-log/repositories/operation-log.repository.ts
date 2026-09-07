import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { OperationLogEntity } from '../entities/operation-log.entity';

export interface OperationLogInsert {
  entityType: string;
  entityId: string;
  entityCode: string | null;
  action: string;
  operatorId: string | null;
  operatorName: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
}

/** Data access only - no business rules here (AGENTS.md §8). */
@Injectable()
export class OperationLogRepository {
  constructor(
    @InjectRepository(OperationLogEntity)
    private readonly repository: Repository<OperationLogEntity>,
  ) {}

  async insert(entry: OperationLogInsert): Promise<void> {
    // jsonb `changes` doesn't fit QueryDeepPartialEntity's shape; single
    // controlled cast at the repository boundary.
    const created = this.repository.create(entry as unknown as DeepPartial<OperationLogEntity>);
    await this.repository.save(created);
  }
}
