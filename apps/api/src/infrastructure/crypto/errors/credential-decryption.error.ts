import { DomainError } from '../../../common/errors/domain.error';

/** Credential decryption failed (wrong key, corrupted payload). */
export class CredentialDecryptionError extends DomainError {
  readonly code = 'COMMON_CREDENTIAL_DECRYPT_FAILED';
  readonly httpStatus = 500;

  constructor(message = 'Credential decryption failed', details: Record<string, unknown> = {}) {
    super(message, details);
  }
}
