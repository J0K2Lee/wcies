import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { QueryFailedError } from 'typeorm';
import { OperationLogService, OperatorContext } from '../../operation-log/operation-log.service';
import { EMAIL_PURPOSE_INVITE } from '../email-verification.constants';
import { USER_ROLE_ADMIN, USER_ROLE_OPERATOR } from '../enums/user-role.enum';
import { UserEntity } from '../entities/user.entity';
import {
  CannotDisableSelfError,
  EmailAlreadyInUseError,
  InviteNotResendableError,
  UserNotFoundError,
  UsernameAlreadyExistsError,
} from '../errors/user-errors';
import {
  USER_STATUS_ACTIVE,
  USER_STATUS_DISABLED,
  USER_STATUS_PENDING_VERIFICATION,
} from '../enums/user-status.enum';
import { UserRepository } from '../repositories/user.repository';
import { EmailVerificationService } from './email-verification.service';
import { UserService } from './user.service';
import { UserResponseDto } from '../dto/response/login.response.dto';
import { CreateUserRequestDto } from '../dto/request/create-user.request.dto';

const ENTITY_TYPE = 'USER';

/** Pg unique-constraint violation (race-safe duplicate guard): constraint name or null. */
function isUniqueViolation(error: unknown): string | null {
  if (error instanceof QueryFailedError) {
    const driver = error.driverError as { code?: unknown; constraint?: unknown };
    if (driver.code === '23505') {
      return typeof driver.constraint === 'string' ? driver.constraint : '';
    }
  }
  return null;
}

/**
 * Admin-side user management (docs/business-rules/users.md):
 *
 * - created users land in PENDING_VERIFICATION and receive an invite email;
 *   the invite link both proves the mailbox and sets the initial password;
 * - the invite send is best-effort: a failed SMTP delivery keeps the user
 *   row and reports inviteSent=false (retry via resend-invite).
 */
@Injectable()
export class UserAdminService {
  private readonly logger = new Logger(UserAdminService.name);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly userService: UserService,
    private readonly verification: EmailVerificationService,
    private readonly operationLog: OperationLogService,
  ) {}

  async list(): Promise<UserResponseDto[]> {
    const users = await this.userRepository.listAll();
    return users.map((user) => this.userService.toResponse(user));
  }

  async create(
    dto: CreateUserRequestDto,
    operator: OperatorContext,
  ): Promise<{
    user: UserResponseDto;
    inviteSent: boolean;
    inviteError: string | null;
  }> {
    if (await this.userRepository.existsByUsername(dto.username)) {
      throw new UsernameAlreadyExistsError(dto.username);
    }
    if (await this.userRepository.existsByEmail(dto.email)) {
      throw new EmailAlreadyInUseError(dto.email);
    }

    // No initial password: a random unusable hash is set now and replaced by
    // the invitee when they confirm the email link (docs/business-rules/users.md).
    const placeholderHash = await argon2.hash(randomBytes(32).toString('hex'));
    let user: UserEntity;
    try {
      user = await this.userRepository.insert({
        username: dto.username,
        email: dto.email,
        passwordHash: placeholderHash,
        status: USER_STATUS_PENDING_VERIFICATION,
        role: dto.role === USER_ROLE_ADMIN ? USER_ROLE_ADMIN : USER_ROLE_OPERATOR,
      });
    } catch (error) {
      const constraint = isUniqueViolation(error);
      if (constraint === 'uq_users_username') throw new UsernameAlreadyExistsError(dto.username);
      if (constraint === 'uq_users_email') throw new EmailAlreadyInUseError(dto.email);
      throw error;
    }

    const { sent, error } = await this.trySendInvite(user);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: user.id,
      entityCode: user.username,
      action: 'CREATE',
      changes: {
        username: { from: null, to: user.username },
        email: { from: null, to: user.email },
        role: { from: null, to: user.role },
        status: { from: null, to: user.status },
        inviteSent: { from: null, to: sent },
      },
      operator,
    });
    return { user: this.userService.toResponse(user), inviteSent: sent, inviteError: error };
  }

  /** Re-sends the invite email while the mailbox is still unproven. */
  async resendInvite(userId: string, operator: OperatorContext): Promise<UserResponseDto> {
    const user = await this.requireUser(userId);
    if (user.emailVerifiedAt !== null) {
      throw new InviteNotResendableError('该账号邮箱已验证，无需重发邀请');
    }
    if (user.status !== USER_STATUS_PENDING_VERIFICATION) {
      throw new InviteNotResendableError('仅待邮箱验证的账号可以重发邀请');
    }
    const { error } = await this.trySendInvite(user);
    if (error !== null) {
      // Cooldown / SMTP failures propagate; the admin sees the reason.
      throw new InviteNotResendableError(error);
    }
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: user.id,
      entityCode: user.username,
      action: 'RESEND_INVITE',
      changes: {},
      operator,
    });
    return this.userService.toResponse(user);
  }

  /**
   * Enable / disable. "Enable" of an unverified account restores
   * PENDING_VERIFICATION, not ACTIVE - verification is the only activation
   * path (docs/business-rules/users.md).
   */
  async setStatus(
    operatorUserId: string,
    userId: string,
    target: typeof USER_STATUS_ACTIVE,
    operator: OperatorContext,
  ): Promise<UserResponseDto> {
    const user = await this.requireUser(userId);
    if (target === USER_STATUS_DISABLED && user.id === operatorUserId) {
      throw new CannotDisableSelfError();
    }
    const nextStatus =
      target === USER_STATUS_DISABLED
        ? USER_STATUS_DISABLED
        : user.emailVerifiedAt !== null
          ? USER_STATUS_ACTIVE
          : USER_STATUS_PENDING_VERIFICATION;
    if (nextStatus !== user.status) {
      await this.userRepository.updateStatus(user.id, nextStatus);
    }
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: user.id,
      entityCode: user.username,
      action: 'UPDATE_STATUS',
      changes: { status: { from: user.status, to: nextStatus } },
      operator,
    });
    return this.userService.toResponse({ ...user, status: nextStatus });
  }

  private async requireUser(userId: string): Promise<UserEntity> {
    const user = await this.userRepository.findById(userId);
    if (user === null) {
      throw new UserNotFoundError(userId);
    }
    return user;
  }

  private async trySendInvite(user: UserEntity): Promise<{ sent: boolean; error: string | null }> {
    try {
      await this.verification.issueAndSend(
        { id: user.id, username: user.username },
        user.email ?? '',
        EMAIL_PURPOSE_INVITE,
      );
      return { sent: true, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`invite email failed for user ${user.username}: ${message}`);
      return { sent: false, error: message };
    }
  }
}
