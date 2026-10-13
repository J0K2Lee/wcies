import { DomainError } from '../../../common/errors/domain.error';

export class UserNotFoundError extends DomainError {
  readonly code = 'USER_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super('用户不存在', { id });
  }
}

export class UsernameAlreadyExistsError extends DomainError {
  readonly code = 'USER_USERNAME_EXISTS';
  readonly httpStatus = 409;

  constructor(username: string) {
    super('用户名已被使用', { username });
  }
}

export class EmailAlreadyInUseError extends DomainError {
  readonly code = 'USER_EMAIL_IN_USE';
  readonly httpStatus = 409;

  constructor(email: string) {
    super('邮箱已被其他账号使用', { email });
  }
}

export class CannotDisableSelfError extends DomainError {
  readonly code = 'USER_CANNOT_DISABLE_SELF';
  readonly httpStatus = 409;

  constructor() {
    super('不能停用自己的账号');
  }
}

export class EmailNotVerifiedError extends DomainError {
  readonly code = 'USER_EMAIL_NOT_VERIFIED';
  readonly httpStatus = 409;

  constructor(message = '该操作要求邮箱已验证，请先完成邮箱验证') {
    super(message);
  }
}

export class InvalidCurrentPasswordError extends DomainError {
  readonly code = 'USER_INVALID_CURRENT_PASSWORD';
  readonly httpStatus = 403;

  constructor() {
    super('当前密码不正确');
  }
}

export class EmailUnchangedError extends DomainError {
  readonly code = 'USER_EMAIL_UNCHANGED';
  readonly httpStatus = 400;

  constructor() {
    super('新邮箱不能与当前邮箱相同');
  }
}

export class UserDisabledError extends DomainError {
  readonly code = 'USER_DISABLED';
  readonly httpStatus = 403;

  constructor() {
    super('账号已被停用，请联系管理员');
  }
}

/** Verifying a token that is unknown, expired, already used or wrong-purpose. */
export class EmailVerificationInvalidError extends DomainError {
  readonly code = 'USER_EMAIL_TOKEN_INVALID';
  readonly httpStatus = 400;

  constructor(reason: 'NOT_FOUND' | 'EXPIRED' | 'CONSUMED' | 'WRONG_PURPOSE') {
    super(
      reason === 'EXPIRED'
        ? '验证链接已过期，请重新发起'
        : reason === 'CONSUMED'
          ? '验证链接已被使用，请重新发起'
          : '验证链接无效',
      { reason },
    );
  }
}

export class EmailSendCooldownError extends DomainError {
  readonly code = 'USER_EMAIL_SEND_COOLDOWN';
  readonly httpStatus = 429;

  constructor(waitSeconds: number) {
    super(`发送过于频繁，请 ${waitSeconds} 秒后重试`, { waitSeconds });
  }
}

export class InviteNotResendableError extends DomainError {
  readonly code = 'USER_INVITE_NOT_RESENDABLE';
  readonly httpStatus = 409;

  constructor(message: string) {
    super(message);
  }
}
