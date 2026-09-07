import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformEntity } from '../entities/platform.entity';

/** Data access only - no business rules here (AGENTS.md §8). */
@Injectable()
export class PlatformRepository {
  constructor(
    @InjectRepository(PlatformEntity)
    private readonly repository: Repository<PlatformEntity>,
  ) {}

  async list(): Promise<PlatformEntity[]> {
    return this.repository.find({ order: { code: 'ASC' } });
  }

  async findById(id: string): Promise<PlatformEntity | null> {
    return this.repository.findOneBy({ id });
  }

  async findByCode(code: string): Promise<PlatformEntity | null> {
    return this.repository.findOneBy({ code });
  }

  async insert(
    platform: Pick<PlatformEntity, 'code' | 'name' | 'status'>,
  ): Promise<PlatformEntity> {
    const created = this.repository.create(platform);
    return this.repository.save(created);
  }
}
