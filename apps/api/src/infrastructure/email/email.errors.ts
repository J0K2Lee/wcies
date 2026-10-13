import { DomainError } from '../../common/errors/domain.error';

/** SMTP settings absent - email-dependent features must fail loudly. */
export class EmailNotConfiguredError extends DomainError {
  readonly code = 'EMAIL_NOT_CONFIGURED';
  readonly httpStatus = 503;

  constructor() {
    super('邮件服务未配置（SMTP_HOST / SMTP_USER / SMTP_PASSWORD），无法发送验证邮件');
  }
}

/** SMTP conversation failed (network, auth rejected, provider error). */
export class EmailDeliveryError extends DomainError {
  readonly code = 'EMAIL_DELIVERY_FAILED';
  readonly httpStatus = 502;

  constructor(reason: string) {
    super('验证邮件发送失败，请稍后重试或联系管理员', { reason });
  }
}
