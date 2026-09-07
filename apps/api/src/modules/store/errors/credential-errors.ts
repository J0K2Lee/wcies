import { DomainError } from '../../../common/errors/domain.error';

export class CredentialNotFoundError extends DomainError {
  readonly code = 'CREDENTIAL_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`Credential not found: ${id}`, { id });
  }
}

export class CredentialAlreadyExistsError extends DomainError {
  readonly code = 'CREDENTIAL_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(storeId: string, credentialType: string) {
    super(`Credential of this type already exists for the store`, { storeId, credentialType });
  }
}
