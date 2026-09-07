import { DomainError } from '../../../common/errors/domain.error';

export class PlatformNotFoundError extends DomainError {
  readonly code = 'PLATFORM_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(identifier: string) {
    super(`Platform not found: ${identifier}`, { identifier });
  }
}
