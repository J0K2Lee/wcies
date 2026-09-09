import { Injectable } from '@nestjs/common';
import { PlatformCredentialContext } from '@wcies/platform-contracts';
import { PlatformAdapterRegistry } from '../../integration/platform-adapter.registry';
import { PlatformApiError } from '../../integration/platform-error';
import { PlatformService } from '../../platform/platform.service';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { StoreService } from './store.service';
import { StoreNotFoundError } from '../errors/store-errors';
import { CredentialNotFoundError } from '../errors/credential-errors';
import { PlatformCredentialRepository } from '../repositories/platform-credential.repository';
import { PlatformCredentialService } from './platform-credential.service';
import { CredentialValidateResultDto } from '../dto/credential.dto';

/**
 * Credential validation (Sprint 5 task §32-§33): decrypt -> adapter
 * validateCredential (safe read-only call) -> persist validation metadata.
 *
 * Secrets never reach the response, the log or the operation log; only the
 * normalized outcome (VALID / INVALID / ERROR + sanitized message).
 */
@Injectable()
export class CredentialValidationService {
  constructor(
    private readonly storeService: StoreService,
    private readonly platformService: PlatformService,
    private readonly credentialRepository: PlatformCredentialRepository,
    private readonly credentialService: PlatformCredentialService,
    private readonly registry: PlatformAdapterRegistry,
    private readonly operationLog: OperationLogService,
  ) {}

  async validate(
    storeId: string,
    credentialId: string,
    operator: OperatorContext,
  ): Promise<CredentialValidateResultDto> {
    const store = await this.storeService.getEntityById(storeId);
    if (store === null) {
      throw new StoreNotFoundError(storeId);
    }
    const credential = await this.credentialRepository.findById(credentialId);
    if (credential === null || credential.storeId !== storeId) {
      throw new CredentialNotFoundError(credentialId);
    }
    const platform = await this.platformService.getEntityById(store.platformId);
    if (platform === null) {
      throw new StoreNotFoundError(storeId);
    }
    const adapter = this.registry.getAdapter(platform.code);

    const context: PlatformCredentialContext = {
      storeId,
      platform: adapter.platformCode,
      credential: await this.credentialService.decryptPayload(credential),
    };

    let validationStatus: 'VALID' | 'INVALID' | 'ERROR';
    let error: string | null = null;
    try {
      await adapter.validateCredential(context);
      validationStatus = 'VALID';
    } catch (failure: unknown) {
      if (
        failure instanceof PlatformApiError &&
        failure.platformError.code === 'PLATFORM_AUTH_ERROR'
      ) {
        validationStatus = 'INVALID';
      } else {
        validationStatus = 'ERROR';
      }
      error = failure instanceof Error ? failure.message.slice(0, 1000) : String(failure);
    }

    await this.credentialRepository.updateValidationMeta(credentialId, {
      lastValidatedAt: new Date(),
      lastValidationStatus: validationStatus,
      lastValidationError: error,
    });
    await this.operationLog.record({
      entityType: 'PLATFORM_CREDENTIAL',
      entityId: credentialId,
      entityCode: `${credential.credentialType}@${storeId}`,
      action: 'VALIDATE',
      // Metadata only - never secret material (AGENTS.md §29).
      changes: {
        lastValidationStatus: { from: credential.lastValidationStatus, to: validationStatus },
      },
      operator,
    });

    return {
      credentialId,
      storeId,
      validationStatus,
      error,
      validatedAt: new Date(),
    };
  }
}
