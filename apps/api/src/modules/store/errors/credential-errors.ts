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

/** 绑定凭证必须声明有效期（长期 / 到期日），且到期日必须是将来的时间。 */
export class CredentialValidityInvalidError extends DomainError {
  readonly code = 'CREDENTIAL_VALIDITY_INVALID';
  readonly httpStatus = 422;

  constructor(message: string) {
    super(message);
  }
}
