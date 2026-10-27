import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSettingEntity } from '../entities/system-setting.entity';

/** Data access only (AGENTS.md §8)。 */
@Injectable()
export class SystemSettingRepository {
  constructor(
    @InjectRepository(SystemSettingEntity)
    private readonly repository: Repository<SystemSettingEntity>,
  ) {}

  async find(key: string): Promise<SystemSettingEntity | null> {
    return this.repository.findOneBy({ key });
  }

  async upsert(
    key: string,
    value: Record<string, unknown>,
    updatedBy: string | null,
  ): Promise<void> {
    await this.repository.upsert(
      { key, value: value as never, updatedBy, updatedAt: new Date() },
      { conflictPaths: ['key'] },
    );
  }
}
