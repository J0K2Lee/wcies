import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';
import { EmailVerificationService } from './email-verification.service';
import { EmailVerificationTokenRepository } from '../repositories/email-verification-token.repository';
import { EmailService } from '../../../infrastructure/email/email.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import {
  EMAIL_PURPOSE_EMAIL_CHANGE,
  EMAIL_PURPOSE_INVITE,
  EMAIL_PURPOSE_PASSWORD_CHANGE,
} from '../email-verification.constants';
import { EmailVerificationTokenEntity } from '../entities/email-verification-token.entity';
import { EmailSendCooldownError, EmailVerificationInvalidError } from '../errors/user-errors';

function tokenRow(
  overrides: Partial<EmailVerificationTokenEntity> = {},
): EmailVerificationTokenEntity {
  return {
    id: 'row-1',
    userId: 'user-1',
    purpose: EMAIL_PURPOSE_PASSWORD_CHANGE,
    email: 'user@example.com',
    tokenHash: 'hash',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function buildService() {
  const tokenRepository = {
    insert: vi.fn(),
    findByTokenHash: vi.fn(),
    consume: vi.fn(),
    consumeOutstanding: vi.fn(),
  };
  const emailService = { send: vi.fn(), isConfigured: vi.fn(() => true) };
  const redisClient = {
    set: vi.fn(async (): Promise<string | null> => 'OK'),
    ttl: vi.fn(async () => 42),
  };
  const redis = { client: redisClient };
  const config = { get: vi.fn(() => 'http://localhost:5173') };
  const service = new EmailVerificationService(
    tokenRepository as unknown as EmailVerificationTokenRepository,
    emailService as unknown as EmailService,
    redis as unknown as RedisService,
    config as never,
  );
  return { service, tokenRepository, emailService, redisClient };
}

/** Extracts the raw token from the link inside the sent email HTML. */
function tokenFromSentEmail(emailService: { send: Mock }): string {
  const html = emailService.send.mock.calls[0]?.[0]?.html as string;
  const match = /token=([0-9a-f]{64})/.exec(html);
  if (match === null) {
    throw new Error('no token found in sent email');
  }
  return match[1] as string;
}

describe('EmailVerificationService', () => {
  let env: ReturnType<typeof buildService>;

  beforeEach(() => {
    env = buildService();
    vi.clearAllMocks();
  });

  it('issues a hashed single-use token and emails the purpose-specific link', async () => {
    await env.service.issueAndSend(
      { id: 'user-1', username: 'alice' },
      'alice@example.com',
      EMAIL_PURPOSE_PASSWORD_CHANGE,
    );
    expect(env.tokenRepository.consumeOutstanding).toHaveBeenCalledWith(
      'user-1',
      EMAIL_PURPOSE_PASSWORD_CHANGE,
    );
    expect(env.tokenRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', email: 'alice@example.com' }),
    );
    const storedHash = env.tokenRepository.insert.mock.calls[0]?.[0]?.tokenHash as string;
    const rawToken = tokenFromSentEmail(env.emailService);
    expect(storedHash).toHaveLength(64);
    expect(storedHash).not.toEqual(rawToken); // only the SHA-256 hash is stored
    expect(env.emailService.send.mock.calls[0]?.[0]?.to).toBe('alice@example.com');

    // Round trip: the emailed token verifies back to the user.
    env.tokenRepository.findByTokenHash.mockResolvedValue(
      tokenRow({
        tokenHash: storedHash,
        purpose: EMAIL_PURPOSE_PASSWORD_CHANGE,
        email: 'alice@example.com',
      }),
    );
    env.tokenRepository.consume.mockResolvedValue(true);
    const result = await env.service.verify(rawToken, EMAIL_PURPOSE_PASSWORD_CHANGE);
    expect(result).toEqual({ userId: 'user-1', email: 'alice@example.com' });
  });

  it('uses a distinct link path per purpose', async () => {
    for (const purpose of [EMAIL_PURPOSE_INVITE, EMAIL_PURPOSE_EMAIL_CHANGE] as const) {
      env.emailService.send.mockClear();
      await env.service.issueAndSend({ id: 'u', username: 'n' }, 'a@b.co', purpose);
      const html = env.emailService.send.mock.calls[0]?.[0]?.html as string;
      expect(html).toContain(
        purpose === EMAIL_PURPOSE_INVITE ? '/invite?token=' : '/change-email/confirm?token=',
      );
    }
  });

  it('rejects sending while the per-purpose cooldown is active', async () => {
    env.redisClient.set.mockResolvedValue(null); // NX lost the race -> cooldown
    await expect(
      env.service.issueAndSend({ id: 'u', username: 'n' }, 'a@b.co', EMAIL_PURPOSE_INVITE),
    ).rejects.toMatchObject({ code: 'USER_EMAIL_SEND_COOLDOWN' });
    expect(env.tokenRepository.insert).not.toHaveBeenCalled();
  });

  it('rejects unknown tokens, wrong purposes, expired and consumed tokens', async () => {
    env.tokenRepository.findByTokenHash.mockResolvedValue(null);
    await expect(env.service.verify('ab'.repeat(32), EMAIL_PURPOSE_INVITE)).rejects.toMatchObject({
      code: 'USER_EMAIL_TOKEN_INVALID',
      details: { reason: 'NOT_FOUND' },
    });

    env.tokenRepository.findByTokenHash.mockResolvedValue(
      tokenRow({ purpose: EMAIL_PURPOSE_INVITE }),
    );
    await expect(
      env.service.verify('ab'.repeat(32), EMAIL_PURPOSE_PASSWORD_CHANGE),
    ).rejects.toMatchObject({ details: { reason: 'WRONG_PURPOSE' } });

    env.tokenRepository.findByTokenHash.mockResolvedValue(
      tokenRow({ expiresAt: new Date(Date.now() - 1) }),
    );
    await expect(
      env.service.verify('ab'.repeat(32), EMAIL_PURPOSE_PASSWORD_CHANGE),
    ).rejects.toMatchObject({ details: { reason: 'EXPIRED' } });

    env.tokenRepository.findByTokenHash.mockResolvedValue(tokenRow({ consumedAt: new Date() }));
    await expect(
      env.service.verify('ab'.repeat(32), EMAIL_PURPOSE_PASSWORD_CHANGE),
    ).rejects.toMatchObject({ details: { reason: 'CONSUMED' } });
  });

  it('treats a lost consume race as consumed (single use)', async () => {
    env.tokenRepository.findByTokenHash.mockResolvedValue(tokenRow());
    env.tokenRepository.consume.mockResolvedValue(false);
    await expect(
      env.service.verify('ab'.repeat(32), EMAIL_PURPOSE_PASSWORD_CHANGE),
    ).rejects.toBeInstanceOf(EmailVerificationInvalidError);
  });

  it('propagates cooldown errors typed correctly', async () => {
    env.redisClient.set.mockResolvedValue(null);
    await expect(
      env.service.issueAndSend({ id: 'u', username: 'n' }, 'a@b.co', EMAIL_PURPOSE_INVITE),
    ).rejects.toBeInstanceOf(EmailSendCooldownError);
  });
});
