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

/** 订阅/绑定的输入不合法（未知通道、未知过滤字段、空地址）。 */
export class NotificationInvalidInputError extends DomainError {
  readonly code = 'NOTIFICATION_INVALID_INPUT';
  readonly httpStatus = 422;

  constructor(message: string) {
    super(message);
  }
}
