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

  /** 扫描查询走原生 SQL（需要 join stores/platforms）。 */
  private get dataSource() {
    return this.repository.manager.connection;
  }

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

  async delete(id: string): Promise<void> {
    await this.repository.delete({ id });
  }

  /**
   * 即将到期 / 已过期的 ACTIVE 凭证（2026-10-26）：只含**已声明**有效期的行
   * （validity_declared_at 非空且 expires_at 非空）。
   */
  async listExpiringWithin(days: number): Promise<
    Array<{
      id: string;
      storeId: string;
      credentialType: string;
      expiresAt: Date;
      storeCode: string;
      storeName: string;
      platformCode: string;
    }>
  > {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        store_id: string;
        credential_type: string;
        expires_at: Date;
        store_code: string;
        store_name: string;
        platform_code: string;
      }>
    >(
      `SELECT pc.id, pc.store_id, pc.credential_type, pc.expires_at,
              s.store_code, s.name AS store_name, p.code AS platform_code
         FROM platform_credentials pc
         JOIN stores s ON s.id = pc.store_id
         JOIN platforms p ON p.id = s.platform_id
        WHERE pc.status = 'ACTIVE'
          AND pc.validity_declared_at IS NOT NULL
          AND pc.expires_at IS NOT NULL
          AND pc.expires_at <= now() + ($1 || ' days')::interval
        ORDER BY pc.expires_at ASC
        LIMIT 1000`,
      [String(days)],
    );
    return rows.map((row) => ({
      id: row.id,
      storeId: row.store_id,
      credentialType: row.credential_type,
      expiresAt: row.expires_at,
      storeCode: row.store_code,
      storeName: row.store_name,
      platformCode: row.platform_code,
    }));
  }

  /** Validation metadata write (Sprint 5 §33); error text already sanitized. */
  async updateValidationMeta(
    id: string,
    meta: {
      lastValidatedAt: Date;
      lastValidationStatus: string;
      lastValidationError: string | null;
    },
  ): Promise<void> {
    await this.repository.update({ id }, meta);
  }
}
