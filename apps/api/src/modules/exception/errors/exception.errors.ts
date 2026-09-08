import { DomainError } from '../../../common/errors/domain.error';

export class ExceptionNotFoundError extends DomainError {
  readonly code = 'EXCEPTION_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super('异常不存在', { id });
  }
}

/** Only OPEN exceptions can be resolved / ignored (task §27). */
export class ExceptionStateInvalidError extends DomainError {
  readonly code = 'EXCEPTION_STATE_INVALID';
  readonly httpStatus = 409;

  constructor(id: string, currentStatus: string) {
    super(`异常状态不允许该操作（当前: ${currentStatus}）`, { id, currentStatus });
  }
}
