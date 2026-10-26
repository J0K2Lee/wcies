import { Injectable } from '@nestjs/common';
import {
  CredentialEncryptionService,
  EncryptedCredential,
} from '../../../infrastructure/crypto/credential-encryption.service';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { StoreNotFoundError } from '../errors/store-errors';
import { StoreService } from './store.service';
import {
  CredentialAlreadyExistsError,
  CredentialNotFoundError,
  CredentialValidityInvalidError,
} from '../errors/credential-errors';
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

    const validity = this.resolveValidity(dto.longTerm, dto.expiresAt);
    const encrypted = await this.encryptPayload(dto.payload);
    const credential = await this.repository.insert({
      storeId,
      credentialType: dto.credentialType,
      encryptedPayload: encrypted,
      status: 'ACTIVE',
      expiresAt: validity.expiresAt,
      validityDeclaredAt: new Date(),
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
    dto: { payload: Record<string, unknown>; longTerm?: boolean; expiresAt?: string },
    operator: OperatorContext,
  ): Promise<CredentialResponseDto> {
    const credential = await this.findOwnedOrThrow(storeId, credentialId);
    const validity =
      dto.longTerm === undefined && dto.expiresAt === undefined
        ? null
        : this.resolveValidity(dto.longTerm, dto.expiresAt);
    const encrypted = await this.encryptPayload(dto.payload);
    await this.repository.update(credential.id, {
      encryptedPayload: encrypted,
      status: 'ACTIVE',
      ...(validity === null
        ? {}
        : { expiresAt: validity.expiresAt, validityDeclaredAt: new Date() }),
    });
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

  /** Re-enables a disabled credential (same payload, no re-entry needed). */
  async enable(
    storeId: string,
    credentialId: string,
    operator: OperatorContext,
  ): Promise<CredentialResponseDto> {
    const credential = await this.findOwnedOrThrow(storeId, credentialId);
    await this.repository.update(credential.id, { status: 'ACTIVE' });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: credential.id,
      entityCode: `${credential.credentialType}@${storeId}`,
      action: 'ENABLE',
      changes: { status: { from: credential.status, to: 'ACTIVE' } },
      operator,
    });
    const updated = await this.repository.findById(credential.id);
    return this.toResponse(updated as PlatformCredentialEntity);
  }

  /**
   * Removes a credential record (a wrong/mistyped key must be replaceable).
   *
   * Credentials carry no business history — orders and inventory reference the
   * store, never the credential — so a hard delete is safe here. The audit
   * entry records the type and status only; the secret is never written to the
   * operation log (AGENTS.md §29).
   */
  async remove(storeId: string, credentialId: string, operator: OperatorContext): Promise<void> {
    const credential = await this.findOwnedOrThrow(storeId, credentialId);
    await this.repository.delete(credential.id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: credential.id,
      entityCode: `${credential.credentialType}@${storeId}`,
      action: 'DELETE',
      changes: { credentialType: { from: credential.credentialType, to: null } },
      operator,
    });
  }

  /** Decrypts a store credential for future platform clients (never logged). */
  async decryptPayload(credential: PlatformCredentialEntity): Promise<Record<string, unknown>> {
    const encrypted = JSON.parse(credential.encryptedPayload) as EncryptedCredential;
    return JSON.parse(await this.encryption.decrypt(encrypted)) as Record<string, unknown>;
  }

  /**
   * Sync engine hook (Sprint 5 §32): decrypted ACTIVE credential payload of
   * the given type, or null when absent/disabled. Secrets stay inside the
   * caller's StoreContext - never logged, never returned by any API.
   */
  async getDecryptedActivePayload(
    storeId: string,
    credentialType: string,
  ): Promise<Record<string, unknown> | null> {
    const credential = await this.repository.findByStoreAndType(storeId, credentialType);
    if (credential === null || credential.status !== 'ACTIVE') {
      return null;
    }
    return this.decryptPayload(credential);
  }

  /** Sync dashboard hook (Sprint 5 §35): secret-free validation metadata. */
  async getValidationMeta(
    storeId: string,
    credentialType: string,
  ): Promise<{
    credentialId: string;
    configured: boolean;
    lastValidatedAt: Date | null;
    lastValidationStatus: string | null;
    lastValidationError: string | null;
  } | null> {
    const credential = await this.repository.findByStoreAndType(storeId, credentialType);
    if (credential === null) {
      return null;
    }
    return {
      credentialId: credential.id,
      configured: credential.status === 'ACTIVE',
      lastValidatedAt: credential.lastValidatedAt,
      lastValidationStatus: credential.lastValidationStatus,
      lastValidationError: credential.lastValidationError,
    };
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
      lastValidatedAt: credential.lastValidatedAt,
      lastValidationStatus: credential.lastValidationStatus,
      lastValidationError: credential.lastValidationError,
      createdAt: credential.createdAt,
      expiresAt: credential.expiresAt,
      validityDeclared: credential.validityDeclaredAt !== null,
      daysLeft: daysLeft(credential.expiresAt),
      updatedAt: credential.updatedAt,
    };
  }

  /**
   * 有效期声明（2026-10-26 用户需求）：必须二选一。
   * 历史数据未声明的行保持 usable，但扫描会跳过并提示补全。
   */
  private resolveValidity(
    longTerm: boolean | undefined,
    expiresAt: string | undefined,
  ): { expiresAt: Date | null } {
    if (longTerm === true && expiresAt !== undefined) {
      throw new CredentialValidityInvalidError('长期有效与到期日只能二选一');
    }
    if (longTerm === true) {
      return { expiresAt: null };
    }
    if (expiresAt === undefined || expiresAt === '') {
      throw new CredentialValidityInvalidError(
        '必须声明 API Key 的有效期：选择「长期有效」或填写到期时间',
      );
    }
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new CredentialValidityInvalidError('到期时间格式无法解析');
    }
    if (parsed.getTime() <= Date.now()) {
      throw new CredentialValidityInvalidError('到期时间必须晚于当前时间');
    }
    return { expiresAt: parsed };
  }
}

/** 距离到期天数（向上取整）；NULL = 长期或未声明。 */
export function daysLeft(expiresAt: Date | null): number | null {
  if (expiresAt === null) {
    return null;
  }
  return Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);
}
