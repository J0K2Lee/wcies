import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { QueryFailedError } from 'typeorm';
import {
  EMAIL_PURPOSE_EMAIL_CHANGE,
  EMAIL_PURPOSE_INVITE,
  EMAIL_PURPOSE_PASSWORD_CHANGE,
} from '../email-verification.constants';
import { UserEntity } from '../entities/user.entity';
import {
  EmailAlreadyInUseError,
  EmailNotVerifiedError,
  EmailUnchangedError,
  InvalidCurrentPasswordError,
  UserDisabledError,
  UserNotFoundError,
} from '../errors/user-errors';
import { USER_STATUS_DISABLED } from '../enums/user-status.enum';
import { UserRepository } from '../repositories/user.repository';
import { EmailVerificationService } from './email-verification.service';
import { EmailChangeRequestDto } from '../dto/request/email-change.request.dto';

/**
 * Self-service account flows (docs/business-rules/users.md). The confirm
 * endpoints are reached from email links, so the single-use token is the
 * proof - controllers expose them as @Public.
 *
 * Guarantees:
 * - password change / email change may only be REQUESTED against a verified
 *   mailbox ("via verified email" per the business rule);
 * - email change additionally proves account control via the current
 *   password, and proves the NEW mailbox via the link sent to it;
 * - a password change revokes JWT cookies issued before it.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly verification: EmailVerificationService,
  ) {}

  // ---------------------------------------------------------------------
  // Invite confirmation (verify email + set initial password)
  // ---------------------------------------------------------------------

  async confirmInvite(rawToken: string, newPassword: string): Promise<void> {
    const { userId } = await this.verification.verify(rawToken, EMAIL_PURPOSE_INVITE);
    const user = await this.requireUser(userId);
    if (user.status === USER_STATUS_DISABLED) {
      throw new UserDisabledError();
    }
    await this.userRepository.completeInvite(user.id, await argon2.hash(newPassword), new Date());
    this.logger.log(`invite confirmed, user activated (userId=${user.id})`);
  }

  // ---------------------------------------------------------------------
  // Password change via verified email
  // ---------------------------------------------------------------------

  async requestPasswordChange(user: {
    id: string;
    username: string;
    email: string | null;
    emailVerifiedAt: Date | null;
  }): Promise<void> {
    this.requireVerifiedEmail(user.email, user.emailVerifiedAt);
    await this.verification.issueAndSend(
      { id: user.id, username: user.username },
      user.email,
      EMAIL_PURPOSE_PASSWORD_CHANGE,
    );
  }

  async confirmPasswordChange(rawToken: string, newPassword: string): Promise<void> {
    const { userId } = await this.verification.verify(rawToken, EMAIL_PURPOSE_PASSWORD_CHANGE);
    const user = await this.requireUser(userId);
    if (user.status === USER_STATUS_DISABLED) {
      throw new UserDisabledError();
    }
    // updatePasswordHash also stamps password_changed_at -> pre-change
    // JWT cookies stop authenticating on their next request.
    await this.userRepository.updatePasswordHash(user.id, await argon2.hash(newPassword));
    this.logger.log(`password changed via email verification (userId=${user.id})`);
  }

  // ---------------------------------------------------------------------
  // Email change via verified email
  // ---------------------------------------------------------------------

  async requestEmailChange(user: UserEntity, dto: EmailChangeRequestDto): Promise<void> {
    this.requireVerifiedEmail(user.email, user.emailVerifiedAt);
    const passwordValid = await argon2.verify(user.passwordHash, dto.password).catch(() => false);
    if (!passwordValid) {
      throw new InvalidCurrentPasswordError();
    }
    if (dto.newEmail === user.email) {
      throw new EmailUnchangedError();
    }
    if (await this.userRepository.existsByEmail(dto.newEmail)) {
      throw new EmailAlreadyInUseError(dto.newEmail);
    }
    await this.verification.issueAndSend(
      { id: user.id, username: user.username },
      dto.newEmail,
      EMAIL_PURPOSE_EMAIL_CHANGE,
    );
  }

  async confirmEmailChange(rawToken: string): Promise<{ email: string }> {
    const { userId, email } = await this.verification.verify(rawToken, EMAIL_PURPOSE_EMAIL_CHANGE);
    const user = await this.requireUser(userId);
    if (user.status === USER_STATUS_DISABLED) {
      throw new UserDisabledError();
    }
    try {
      await this.userRepository.updateEmail(user.id, email, new Date());
    } catch (error) {
      // Another account claimed this address between request and confirm.
      if (error instanceof QueryFailedError) {
        const driver = error.driverError as { code?: unknown };
        if (driver.code === '23505') {
          throw new EmailAlreadyInUseError(email);
        }
      }
      throw error;
    }
    this.logger.log(`email changed via verification (userId=${user.id})`);
    return { email };
  }

  private requireVerifiedEmail(
    email: string | null,
    emailVerifiedAt: Date | null,
  ): asserts email is string {
    if (email === null || emailVerifiedAt === null) {
      throw new EmailNotVerifiedError();
    }
  }

  private async requireUser(userId: string): Promise<UserEntity> {
    const user = await this.userRepository.findById(userId);
    if (user === null) {
      throw new UserNotFoundError(userId);
    }
    return user;
  }
}
