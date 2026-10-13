import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { EmailService } from '../../../infrastructure/email/email.service';
import {
  EMAIL_SEND_COOLDOWN_SECONDS,
  EMAIL_TOKEN_BYTES,
  EMAIL_TOKEN_TTL_MS,
  EmailVerificationPurpose,
} from '../email-verification.constants';
import { EmailVerificationTokenRepository } from '../repositories/email-verification-token.repository';
import { EmailSendCooldownError, EmailVerificationInvalidError } from '../errors/user-errors';

/** Link path per purpose - the frontend renders these as public token pages. */
const LINK_PATHS: Record<EmailVerificationPurpose, string> = {
  INVITE: '/invite',
  PASSWORD_CHANGE: '/reset-password',
  EMAIL_CHANGE: '/change-email/confirm',
};

const LINK_TTL_LABELS: Record<EmailVerificationPurpose, string> = {
  INVITE: '48 小时',
  PASSWORD_CHANGE: '30 分钟',
  EMAIL_CHANGE: '1 小时',
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Email verification token core (docs/business-rules/users.md):
 *
 * - raw token = 32 random bytes (hex in the link), only SHA-256 stored;
 * - single use; issuing a new token of the same purpose retires the old one;
 * - sending is throttled per user + purpose via a Redis cooldown.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly tokenRepository: EmailVerificationTokenRepository,
    private readonly emailService: EmailService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Issues a fresh single-use token and sends the verification email.
   * Throws EmailSendCooldownError when the same purpose was sent recently;
   * email delivery failures propagate (the caller decides whether that is
   * fatal - admin user creation keeps the user row and reports the failure).
   */
  async issueAndSend(
    user: { id: string; username: string },
    email: string,
    purpose: EmailVerificationPurpose,
  ): Promise<void> {
    await this.enforceCooldown(user.id, purpose);

    const rawToken = randomBytes(EMAIL_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS[purpose]);
    await this.tokenRepository.consumeOutstanding(user.id, purpose);
    await this.tokenRepository.insert({
      userId: user.id,
      purpose,
      email,
      tokenHash: sha256(rawToken),
      expiresAt,
    });

    const link = `${this.config.get<string>('app.webBaseUrl') ?? 'http://localhost:5173'}${LINK_PATHS[purpose]}?token=${rawToken}`;
    await this.emailService.send(this.composeEmail(user.username, email, purpose, link));
    this.logger.log(`verification email sent (purpose=${purpose} userId=${user.id})`);
  }

  /**
   * Verifies and consumes a token. The token in the link IS the proof, so
   * confirm endpoints may be @Public. Throws EmailVerificationInvalidError
   * for unknown / wrong-purpose / expired / already-used tokens.
   */
  async verify(
    rawToken: string,
    purpose: EmailVerificationPurpose,
  ): Promise<{ userId: string; email: string }> {
    const row = await this.tokenRepository.findByTokenHash(sha256(rawToken));
    if (row === null) {
      throw new EmailVerificationInvalidError('NOT_FOUND');
    }
    if (row.purpose !== purpose) {
      throw new EmailVerificationInvalidError('WRONG_PURPOSE');
    }
    if (row.consumedAt !== null) {
      throw new EmailVerificationInvalidError('CONSUMED');
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new EmailVerificationInvalidError('EXPIRED');
    }
    const consumed = await this.tokenRepository.consume(row.id);
    if (!consumed) {
      // A parallel request won the race for this single-use token.
      throw new EmailVerificationInvalidError('CONSUMED');
    }
    return { userId: row.userId, email: row.email };
  }

  private async enforceCooldown(userId: string, purpose: EmailVerificationPurpose): Promise<void> {
    const key = `auth:email:cooldown:${userId}:${purpose}`;
    const set = await this.redis.client.set(key, '1', 'EX', EMAIL_SEND_COOLDOWN_SECONDS, 'NX');
    if (set !== 'OK') {
      const ttl = await this.redis.client.ttl(key);
      throw new EmailSendCooldownError(ttl > 0 ? ttl : EMAIL_SEND_COOLDOWN_SECONDS);
    }
  }

  private composeEmail(
    username: string,
    to: string,
    purpose: EmailVerificationPurpose,
    link: string,
  ): { to: string; subject: string; text: string; html: string } {
    const intro: Record<EmailVerificationPurpose, string> = {
      INVITE: `管理员为你创建了 WCIES 账号（用户名：${username}）。请点击以下链接验证邮箱并设置登录密码：`,
      PASSWORD_CHANGE: `你正在重置账号 ${username} 的登录密码。请点击以下链接完成重置：`,
      EMAIL_CHANGE: `你正在将账号 ${username} 的登录邮箱更换为本邮箱。请点击以下链接确认更换：`,
    };
    const subject: Record<EmailVerificationPurpose, string> = {
      INVITE: 'WCIES 账号邀请：验证邮箱并设置密码',
      PASSWORD_CHANGE: 'WCIES：重置登录密码',
      EMAIL_CHANGE: 'WCIES：确认更换登录邮箱',
    };
    const footer = `链接有效期为 ${LINK_TTL_LABELS[purpose]}，且只能使用一次。若非本人操作，请忽略本邮件。`;
    const text = `${intro[purpose]}\n\n${link}\n\n${footer}`;
    const html = `
      <p>${intro[purpose]}</p>
      <p><a href="${link}">${link}</a></p>
      <p style="color:#888;font-size:12px">${footer}</p>
    `;
    return { to, subject: subject[purpose], text, html };
  }
}
