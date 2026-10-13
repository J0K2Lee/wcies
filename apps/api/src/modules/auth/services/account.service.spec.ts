import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as argon2 from 'argon2';
import { QueryFailedError } from 'typeorm';
import { AccountService } from './account.service';
import { UserRepository } from '../repositories/user.repository';
import { EmailVerificationService } from './email-verification.service';
import { UserEntity } from '../entities/user.entity';
import {
  EMAIL_PURPOSE_EMAIL_CHANGE,
  EMAIL_PURPOSE_INVITE,
  EMAIL_PURPOSE_PASSWORD_CHANGE,
} from '../email-verification.constants';
import {
  EmailAlreadyInUseError,
  EmailNotVerifiedError,
  EmailUnchangedError,
  InvalidCurrentPasswordError,
  UserDisabledError,
  UserNotFoundError,
} from '../errors/user-errors';

function userEntity(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    passwordHash: 'hash',
    status: 'ACTIVE',
    role: 'OPERATOR',
    emailVerifiedAt: new Date('2026-10-01T00:00:00Z'),
    passwordChangedAt: new Date('2026-10-01T00:00:00Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildService() {
  const userRepository = {
    findById: vi.fn(),
    existsByEmail: vi.fn(),
    updatePasswordHash: vi.fn(),
    completeInvite: vi.fn(),
    updateEmail: vi.fn(),
  };
  const verification = { issueAndSend: vi.fn(), verify: vi.fn() };
  const service = new AccountService(
    userRepository as unknown as UserRepository,
    verification as unknown as EmailVerificationService,
  );
  return { service, userRepository, verification };
}

const TOKEN = 'ab'.repeat(32);

describe('AccountService.confirmInvite', () => {
  it('activates the account atomically with a fresh password hash', async () => {
    const env = buildService();
    env.verification.verify.mockResolvedValue({ userId: 'user-1', email: 'alice@example.com' });
    env.userRepository.findById.mockResolvedValue(userEntity({ status: 'PENDING_VERIFICATION' }));
    await env.service.confirmInvite(TOKEN, 'new-password-1');
    expect(env.verification.verify).toHaveBeenCalledWith(TOKEN, EMAIL_PURPOSE_INVITE);
    expect(env.userRepository.completeInvite).toHaveBeenCalledWith(
      'user-1',
      expect.any(String),
      expect.any(Date),
    );
    // The stored hash must verify against the chosen password.
    const hash = env.userRepository.completeInvite.mock.calls[0]?.[1] as string;
    await expect(argon2.verify(hash, 'new-password-1')).resolves.toBe(true);
  });

  it('refuses activation of a disabled account', async () => {
    const env = buildService();
    env.verification.verify.mockResolvedValue({ userId: 'user-1', email: 'a@b.co' });
    env.userRepository.findById.mockResolvedValue(userEntity({ status: 'DISABLED' }));
    await expect(env.service.confirmInvite(TOKEN, 'new-password-1')).rejects.toBeInstanceOf(
      UserDisabledError,
    );
  });
});

describe('AccountService password change', () => {
  it('request requires a verified mailbox', async () => {
    const env = buildService();
    await expect(
      env.service.requestPasswordChange({
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        emailVerifiedAt: null,
      }),
    ).rejects.toBeInstanceOf(EmailNotVerifiedError);
    await expect(
      env.service.requestPasswordChange({
        id: 'user-1',
        username: 'alice',
        email: null,
        emailVerifiedAt: null,
      }),
    ).rejects.toBeInstanceOf(EmailNotVerifiedError);
  });

  it('request sends the reset link to the verified mailbox', async () => {
    const env = buildService();
    await env.service.requestPasswordChange({
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      emailVerifiedAt: new Date(),
    });
    expect(env.verification.issueAndSend).toHaveBeenCalledWith(
      { id: 'user-1', username: 'alice' },
      'alice@example.com',
      EMAIL_PURPOSE_PASSWORD_CHANGE,
    );
  });

  it('confirm rotates the hash (and thus revokes older JWT cookies)', async () => {
    const env = buildService();
    env.verification.verify.mockResolvedValue({ userId: 'user-1', email: 'a@b.co' });
    env.userRepository.findById.mockResolvedValue(userEntity());
    await env.service.confirmPasswordChange(TOKEN, 'brand-new-pw');
    const hash = env.userRepository.updatePasswordHash.mock.calls[0]?.[1] as string;
    expect(env.userRepository.updatePasswordHash).toHaveBeenCalledWith('user-1', hash);
    await expect(argon2.verify(hash, 'brand-new-pw')).resolves.toBe(true);
  });
});

describe('AccountService email change', () => {
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await argon2.hash('correct-password');
  });

  it('request requires the current password and a verified mailbox', async () => {
    const env = buildService();
    const user = userEntity({ passwordHash });
    await expect(
      env.service.requestEmailChange(user, { newEmail: 'new@b.co', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(InvalidCurrentPasswordError);

    const unverified = userEntity({ passwordHash, emailVerifiedAt: null });
    await expect(
      env.service.requestEmailChange(unverified, {
        newEmail: 'new@b.co',
        password: 'correct-password',
      }),
    ).rejects.toBeInstanceOf(EmailNotVerifiedError);
  });

  it('request rejects unchanged and already-used addresses', async () => {
    const env = buildService();
    const user = userEntity({ passwordHash });
    await expect(
      env.service.requestEmailChange(user, {
        newEmail: 'alice@example.com',
        password: 'correct-password',
      }),
    ).rejects.toBeInstanceOf(EmailUnchangedError);

    env.userRepository.existsByEmail.mockResolvedValue(true);
    await expect(
      env.service.requestEmailChange(user, {
        newEmail: 'taken@b.co',
        password: 'correct-password',
      }),
    ).rejects.toBeInstanceOf(EmailAlreadyInUseError);
  });

  it('request sends the confirmation link to the NEW mailbox', async () => {
    const env = buildService();
    env.userRepository.existsByEmail.mockResolvedValue(false);
    await env.service.requestEmailChange(userEntity({ passwordHash }), {
      newEmail: 'new@b.co',
      password: 'correct-password',
    });
    expect(env.verification.issueAndSend).toHaveBeenCalledWith(
      { id: 'user-1', username: 'alice' },
      'new@b.co',
      EMAIL_PURPOSE_EMAIL_CHANGE,
    );
  });

  it('confirm swaps the email and stamps it verified', async () => {
    const env = buildService();
    env.verification.verify.mockResolvedValue({ userId: 'user-1', email: 'new@b.co' });
    env.userRepository.findById.mockResolvedValue(userEntity());
    const result = await env.service.confirmEmailChange(TOKEN);
    expect(result).toEqual({ email: 'new@b.co' });
    expect(env.userRepository.updateEmail).toHaveBeenCalledWith(
      'user-1',
      'new@b.co',
      expect.any(Date),
    );
  });

  it('confirm maps a unique-constraint race to EmailAlreadyInUseError', async () => {
    const env = buildService();
    env.verification.verify.mockResolvedValue({ userId: 'user-1', email: 'new@b.co' });
    env.userRepository.findById.mockResolvedValue(userEntity());
    env.userRepository.updateEmail.mockImplementation(() => {
      throw new QueryFailedError('UPDATE users', [], { code: '23505' } as never);
    });
    await expect(env.service.confirmEmailChange(TOKEN)).rejects.toBeInstanceOf(
      EmailAlreadyInUseError,
    );
  });
});

describe('AccountService user lookup', () => {
  it('surfaces a missing user as UserNotFoundError', async () => {
    const env = buildService();
    env.verification.verify.mockResolvedValue({ userId: 'ghost', email: 'a@b.co' });
    env.userRepository.findById.mockResolvedValue(null);
    await expect(env.service.confirmEmailChange(TOKEN)).rejects.toBeInstanceOf(UserNotFoundError);
  });
});
