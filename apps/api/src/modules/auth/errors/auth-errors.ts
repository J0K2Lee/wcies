import { DomainError } from '../../../common/errors/domain.error';

export class InvalidCredentialsError extends DomainError {
  readonly code = 'AUTH_INVALID_CREDENTIALS';
  readonly httpStatus = 401;

  constructor() {
    super('Invalid username or password');
  }
}

export class TooManyLoginAttemptsError extends DomainError {
  readonly code = 'AUTH_TOO_MANY_ATTEMPTS';
  readonly httpStatus = 429;

  constructor(waitSeconds: number) {
    super(`Too many login attempts, retry in ${waitSeconds} seconds`, { waitSeconds });
  }
}

export class UnauthorizedError extends DomainError {
  readonly code = 'AUTH_UNAUTHORIZED';
  readonly httpStatus = 401;

  constructor(message = 'Unauthorized') {
    super(message);
  }
}

export class ForbiddenError extends DomainError {
  readonly code = 'AUTH_FORBIDDEN';
  readonly httpStatus = 403;

  constructor(message = 'Admin permission required') {
    super(message);
  }
}
