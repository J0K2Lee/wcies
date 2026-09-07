/**
 * Platform integration contracts.
 *
 * Every external platform (OZON / Wildberries / Yandex Market) is integrated
 * through a PlatformAdapter implementing the contracts below (AGENTS.md §32).
 *
 * Sprint 0 scope: minimal contract shape only. No real adapters yet -
 * OZON / WB / Yandex implementations arrive in later sprints.
 */

/** Known platform codes. Extend only when a new platform is actually integrated. */
export const PLATFORM_CODES = ['OZON', 'WILDBERRIES', 'YANDEX_MARKET'] as const;
export type PlatformCode = (typeof PLATFORM_CODES)[number];

/**
 * Credential payload handed to an adapter for validation.
 * Secrets are already-decrypted values; adapters must never log them.
 */
export interface PlatformCredentialContext {
  readonly storeId: string;
  readonly platform: PlatformCode;
  readonly credential: Readonly<Record<string, unknown>>;
}

/**
 * Base contract every platform adapter implements.
 * Keep it minimal; extend per-sprint with sync/listing/order capabilities
 * only when the corresponding business sprint requires them.
 */
export interface PlatformAdapter {
  readonly platformCode: PlatformCode;

  /** Throws a DomainError-derived error when credentials are invalid. */
  validateCredential(context: PlatformCredentialContext): Promise<void>;
}
