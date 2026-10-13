import { describe, expect, it, vi } from 'vitest';
import { UserAdminService } from './user-admin.service';
import { UserRepository } from '../repositories/user.repository';
import { UserService } from './user.service';
import { EmailVerificationService } from './email-verification.service';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { UserEntity } from '../entities/user.entity';
import { EMAIL_PURPOSE_INVITE } from '../email-verification.constants';
import {
  CannotDisableSelfError,
  EmailAlreadyInUseError,
  InviteNotResendableError,
  UsernameAlreadyExistsError,
} from '../errors/user-errors';

function userEntity(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    passwordHash: 'x',
    status: 'PENDING_VERIFICATION',
    role: 'OPERATOR',
    emailVerifiedAt: null,
    passwordChangedAt: new Date(),
    createdAt: new Date('2026-10-05T08:00:00Z'),
    updatedAt: new Date('2026-10-05T08:00:00Z'),
    ...overrides,
  };
}

function buildService() {
  const userRepository = {
    listAll: vi.fn(),
    existsByUsername: vi.fn(),
    existsByEmail: vi.fn(),
    insert: vi.fn(),
    findById: vi.fn(),
    updateStatus: vi.fn(),
    updatePasswordHash: vi.fn(),
    completeInvite: vi.fn(),
    updateEmail: vi.fn(),
    markEmailVerified: vi.fn(),
  };
  const userService = {
    toResponse: vi.fn((user: UserEntity): Record<string, unknown> => ({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt.toISOString(),
    })),
  };
  const verification = { issueAndSend: vi.fn() };
  const operationLog = { record: vi.fn() };
  const service = new UserAdminService(
    userRepository as unknown as UserRepository,
    userService as unknown as UserService,
    verification as unknown as EmailVerificationService,
    operationLog as unknown as OperationLogService,
  );
  return { service, userRepository, userService, verification, operationLog };
}

const OPERATOR = { userId: 'admin-1', username: 'admin' };

describe('UserAdminService.create', () => {
  it('creates a PENDING_VERIFICATION user and sends the invite', async () => {
    const env = buildService();
    env.userRepository.existsByUsername.mockResolvedValue(false);
    env.userRepository.existsByEmail.mockResolvedValue(false);
    env.userRepository.insert.mockImplementation(async (input: Record<string, string>) =>
      userEntity({ ...input, id: 'new-1' }),
    );
    const result = await env.service.create(
      { username: 'alice', email: 'alice@example.com', role: 'OPERATOR' },
      OPERATOR,
    );
    expect(result.user.status).toBe('PENDING_VERIFICATION');
    expect(result.inviteSent).toBe(true);
    expect(result.inviteError).toBeNull();
    expect(env.verification.issueAndSend).toHaveBeenCalledWith(
      { id: 'new-1', username: 'alice' },
      'alice@example.com',
      EMAIL_PURPOSE_INVITE,
    );
    expect(env.operationLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entityCode: 'alice' }),
    );
  });

  it('keeps the created user when the invite email fails (best-effort send)', async () => {
    const env = buildService();
    env.userRepository.existsByUsername.mockResolvedValue(false);
    env.userRepository.existsByEmail.mockResolvedValue(false);
    env.userRepository.insert.mockResolvedValue(userEntity());
    env.verification.issueAndSend.mockRejectedValue(new Error('smtp down'));
    const result = await env.service.create(
      { username: 'alice', email: 'alice@example.com', role: 'OPERATOR' },
      OPERATOR,
    );
    expect(result.inviteSent).toBe(false);
    expect(result.inviteError).toBe('smtp down');
    expect(result.user.status).toBe('PENDING_VERIFICATION');
  });

  it('rejects duplicate username and duplicate email before insert', async () => {
    const env = buildService();
    env.userRepository.existsByUsername.mockResolvedValue(true);
    await expect(
      env.service.create({ username: 'alice', email: 'a@b.co', role: 'OPERATOR' }, OPERATOR),
    ).rejects.toBeInstanceOf(UsernameAlreadyExistsError);

    env.userRepository.existsByUsername.mockResolvedValue(false);
    env.userRepository.existsByEmail.mockResolvedValue(true);
    await expect(
      env.service.create({ username: 'alice', email: 'a@b.co', role: 'OPERATOR' }, OPERATOR),
    ).rejects.toBeInstanceOf(EmailAlreadyInUseError);
    expect(env.userRepository.insert).not.toHaveBeenCalled();
  });
});

describe('UserAdminService.resendInvite', () => {
  it('rejects already-verified accounts', async () => {
    const env = buildService();
    env.userRepository.findById.mockResolvedValue(userEntity({ emailVerifiedAt: new Date() }));
    await expect(env.service.resendInvite('user-1', OPERATOR)).rejects.toBeInstanceOf(
      InviteNotResendableError,
    );
  });

  it('rejects accounts that are not pending verification', async () => {
    const env = buildService();
    env.userRepository.findById.mockResolvedValue(userEntity({ status: 'DISABLED' }));
    await expect(env.service.resendInvite('user-1', OPERATOR)).rejects.toBeInstanceOf(
      InviteNotResendableError,
    );
  });

  it('sends a fresh invite for a pending account', async () => {
    const env = buildService();
    env.userRepository.findById.mockResolvedValue(userEntity());
    const result = await env.service.resendInvite('user-1', OPERATOR);
    expect(env.verification.issueAndSend).toHaveBeenCalledWith(
      { id: 'user-1', username: 'alice' },
      'alice@example.com',
      EMAIL_PURPOSE_INVITE,
    );
    expect(result.status).toBe('PENDING_VERIFICATION');
  });
});

describe('UserAdminService.setStatus', () => {
  it('forbids disabling yourself', async () => {
    const env = buildService();
    env.userRepository.findById.mockResolvedValue(userEntity({ id: 'admin-1' }));
    await expect(
      env.service.setStatus('admin-1', 'admin-1', 'DISABLED', OPERATOR),
    ).rejects.toBeInstanceOf(CannotDisableSelfError);
  });

  it('re-enabling an unverified account restores PENDING_VERIFICATION, not ACTIVE', async () => {
    const env = buildService();
    env.userRepository.findById.mockResolvedValue(userEntity({ status: 'DISABLED' }));
    const result = await env.service.setStatus('admin-1', 'user-1', 'ACTIVE', OPERATOR);
    expect(result.status).toBe('PENDING_VERIFICATION');
  });

  it('re-enabling a verified account restores ACTIVE', async () => {
    const env = buildService();
    env.userRepository.findById.mockResolvedValue(
      userEntity({ status: 'DISABLED', emailVerifiedAt: new Date() }),
    );
    const result = await env.service.setStatus('admin-1', 'user-1', 'ACTIVE', OPERATOR);
    expect(result.status).toBe('ACTIVE');
  });

  it('disables the account and records the audit entry', async () => {
    const env = buildService();
    env.userRepository.findById.mockResolvedValue(userEntity({ emailVerifiedAt: new Date() }));
    const result = await env.service.setStatus('admin-1', 'user-1', 'DISABLED', OPERATOR);
    expect(result.status).toBe('DISABLED');
    expect(env.userRepository.updateStatus).toHaveBeenCalledWith('user-1', 'DISABLED');
    expect(env.operationLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE_STATUS' }),
    );
  });
});
