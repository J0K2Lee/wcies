import { DomainError } from '../../../common/errors/domain.error';

export class NotificationNotFoundError extends DomainError {
  readonly code = 'NOTIFICATION_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super('通知不存在', { id });
  }
}

export class NotificationRetryInvalidError extends DomainError {
  readonly code = 'NOTIFICATION_RETRY_INVALID';
  readonly httpStatus = 409;

  constructor(message: string) {
    super(message);
  }
}
