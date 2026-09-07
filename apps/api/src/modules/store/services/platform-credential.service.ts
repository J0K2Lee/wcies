import { Injectable } from '@nestjs/common';
import {
  CredentialEncryptionService,
  EncryptedCredential,
} from '../../../infrastructure/crypto/credential-encryption.service';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { StoreNotFoundError } from '../errors/store-errors';
import { StoreService } from './store.service';
import { CredentialAlreadyExistsError, CredentialNotFoundError } from '../errors/credential-errors';
import { PlatformCredentialEntity } from '../entities/platform-credential.entity';
import { PlatformCredentialRepository } from '../repositories/platform-credential.repository';
import { CredentialResponseDto, UpsertCredentialRequestDto } from '../dto/credential.dto';

const ENTITY_TYPE = 'PLATFORM_CREDENTIAL';

/**
 * Store API credentials (task §11/§12).
 *
 * Security invariants (AGENTS.md §29):
 * - payload is encrypted with the Sprint 0 CredentialEncryptionService only;
 * - encryptedPayload is never returned, logged, or written to the audit log;
 * - the operation log records metadata only (type/status/updatedAt).
 */
@Injectable()
export class PlatformCredentialService {
  constructor(
    private readonly repository: PlatformCredentialRepository,
    private readonly storeService: StoreService,
    private readonly encryption: CredentialEncryptionService,
    private readonly operationLog: OperationLogService,
  ) {}

  async listByStore(storeId: string): Promise<CredentialResponseDto[]> {
    const credentials = await this.repository.listByStoreId(storeId);
    return credentials.map((credential) => this.toResponse(credential));
  }

  async create(
    storeId: string,
    dto: UpsertCredentialRequestDto,
    operator: OperatorContext,
  ): Promise<CredentialResponseDto> {
    await this.ensureStoreExists(storeId);
    const existing = await this.repository.findByStoreAndType(storeId, dto.credentialType);
    if (existing !== null) {
      throw new CredentialAlreadyExistsError(storeId, dto.credentialType);
    }

    const encrypted = await this.encryptPayload(dto.payload);
    const credential = await this.repository.insert({
      storeId,
      credentialType: dto.credentialType,
      encryptedPayload: encrypted,
      status: 'ACTIVE',
    });

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: credential.id,
      entityCode: `${dto.credentialType}@${storeId}`,
      action: 'CREATE',
      // Metadata only - the secret material never enters the audit trail.
      changes: {
        credentialType: { from: null, to: dto.credentialType },
        status: { from: null, to: 'ACTIVE' },
      },
      operator,
    });
    return this.toResponse(credential);
  }

  async updatePayload(
    storeId: string,
    credentialId: string,
    payload: Record<string, unknown>,
    operator: OperatorContext,
  ): Promise<CredentialResponseDto> {
    const credential = await this.findOwnedOrThrow(storeId, credentialId);
    const encrypted = await this.encryptPayload(payload);
    await this.repository.update(credential.id, { encryptedPayload: encrypted, status: 'ACTIVE' });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: credential.id,
      entityCode: `${credential.credentialType}@${storeId}`,
      action: 'UPDATE',
      changes: {
        payload: { from: '***', to: '***' },
        status: { from: credential.status, to: 'ACTIVE' },
      },
      operator,
    });
    const updated = await this.repository.findById(credential.id);
    return this.toResponse(updated as PlatformCredentialEntity);
  }

  async disable(
    storeId: string,
    credentialId: string,
    operator: OperatorContext,
  ): Promise<CredentialResponseDto> {
    const credential = await this.findOwnedOrThrow(storeId, credentialId);
    await this.repository.update(credential.id, { status: 'DISABLED' });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: credential.id,
      entityCode: `${credential.credentialType}@${storeId}`,
      action: 'DISABLE',
      changes: { status: { from: credential.status, to: 'DISABLED' } },
      operator,
    });
    const updated = await this.repository.findById(credential.id);
    return this.toResponse(updated as PlatformCredentialEntity);
  }

  /** Decrypts a store credential for future platform clients (never logged). */
  async decryptPayload(credential: PlatformCredentialEntity): Promise<Record<string, unknown>> {
    const encrypted = JSON.parse(credential.encryptedPayload) as EncryptedCredential;
    return JSON.parse(await this.encryption.decrypt(encrypted)) as Record<string, unknown>;
  }

  private async encryptPayload(payload: Record<string, unknown>): Promise<string> {
    const encrypted = await this.encryption.encrypt(JSON.stringify(payload));
    return JSON.stringify(encrypted);
  }

  private async ensureStoreExists(storeId: string): Promise<void> {
    const store = await this.storeService.getEntityById(storeId);
    if (store === null) {
      throw new StoreNotFoundError(storeId);
    }
  }

  private async findOwnedOrThrow(
    storeId: string,
    credentialId: string,
  ): Promise<PlatformCredentialEntity> {
    await this.ensureStoreExists(storeId);
    const credential = await this.repository.findById(credentialId);
    if (credential === null || credential.storeId !== storeId) {
      throw new CredentialNotFoundError(credentialId);
    }
    return credential;
  }

  private toResponse(credential: PlatformCredentialEntity): CredentialResponseDto {
    return {
      id: credential.id,
      storeId: credential.storeId,
      credentialType: credential.credentialType,
      status: credential.status,
      configured: credential.status === 'ACTIVE' && credential.encryptedPayload.length > 0,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
  }
}
