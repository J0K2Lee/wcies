import { DomainError } from '../../common/errors/domain.error';

/** No adapter registered for the platform code (e.g. WB before its sprint). */
export class PlatformNotSupportedError extends DomainError {
  readonly code = 'PLATFORM_NOT_SUPPORTED';
  readonly httpStatus = 400;

  constructor(platformCode: string, registered: string[]) {
    super(`Platform "${platformCode}" has no registered adapter`, {
      platformCode,
      registeredAdapters: registered,
    });
  }
}

/** Store has no ACTIVE usable credential for a platform call. */
export class StoreCredentialMissingError extends DomainError {
  readonly code = 'STORE_CREDENTIAL_MISSING';
  readonly httpStatus = 409;

  constructor(storeId: string, credentialType: string) {
    super(`Store ${storeId} has no ACTIVE ${credentialType} credential`, {
      storeId,
      credentialType,
    });
  }
}

/** The stored credential payload is structurally invalid for the platform. */
export class StoreCredentialMalformedError extends DomainError {
  readonly code = 'STORE_CREDENTIAL_MALFORMED';
  readonly httpStatus = 409;

  constructor(storeId: string, platform: string, reason: string) {
    super(`Credential of store ${storeId} is malformed for ${platform}: ${reason}`, {
      storeId,
      platform,
      reason,
    });
  }
}

/**
 * The platform has no adapter capability for the requested operation (e.g.
 * WB warehouse catalog before its data source is verified). Explicitly NOT
 * supported - never guessed, never degraded to fake data (AGENTS.md §88).
 */
export class PlatformCapabilityUnsupportedError extends DomainError {
  readonly code = 'PLATFORM_CAPABILITY_UNSUPPORTED';
  readonly httpStatus = 422;

  constructor(platformCode: string, capability: string, reason: string) {
    super(`平台 ${platformCode} 暂不支持 ${capability}：${reason}`, {
      platformCode,
      capability,
      reason,
    });
  }
}
