import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformCredentialEntity } from '../entities/platform-credential.entity';

/** Data access only - no business rules here (AGENTS.md §8). */
@Injectable()
export class PlatformCredentialRepository {
  constructor(
    @InjectRepository(PlatformCredentialEntity)
    private readonly repository: Repository<PlatformCredentialEntity>,
  ) {}

  async listByStoreId(storeId: string): Promise<PlatformCredentialEntity[]> {
    return this.repository.find({ where: { storeId }, order: { createdAt: 'ASC' } });
  }

  async findById(id: string): Promise<PlatformCredentialEntity | null> {
    return this.repository.findOneBy({ id });
  }

  async findByStoreAndType(
    storeId: string,
    credentialType: string,
  ): Promise<PlatformCredentialEntity | null> {
    return this.repository.findOneBy({ storeId, credentialType });
  }

  async insert(credential: Partial<PlatformCredentialEntity>): Promise<PlatformCredentialEntity> {
    const created = this.repository.create(credential);
    return this.repository.save(created);
  }

  async update(id: string, patch: Partial<PlatformCredentialEntity>): Promise<void> {
    await this.repository.update({ id }, patch);
  }
}
