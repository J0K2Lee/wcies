import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, UpdateResult, Repository } from 'typeorm';
import { EmailVerificationTokenEntity } from '../entities/email-verification-token.entity';
import { EmailVerificationPurpose } from '../email-verification.constants';

/** Data access only - token business rules live in EmailVerificationService. */
@Injectable()
export class EmailVerificationTokenRepository {
  constructor(
    @InjectRepository(EmailVerificationTokenEntity)
    private readonly repository: Repository<EmailVerificationTokenEntity>,
  ) {}

  async insert(
    token: Pick<
      EmailVerificationTokenEntity,
      'userId' | 'purpose' | 'email' | 'tokenHash' | 'expiresAt'
    >,
  ): Promise<void> {
    await this.repository.insert(token);
  }

  async findByTokenHash(tokenHash: string): Promise<EmailVerificationTokenEntity | null> {
    return this.repository.findOneBy({ tokenHash });
  }

  /**
   * Marks a token consumed only when it is still unused. Returns false when a
   * concurrent confirm beat us to it (single-use guarantee).
   */
  async consume(id: string): Promise<boolean> {
    const result: UpdateResult = await this.repository.update(
      { id, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );
    return (result.affected ?? 0) > 0;
  }

  /** Retires every outstanding token of one purpose (resend invalidates old links). */
  async consumeOutstanding(userId: string, purpose: EmailVerificationPurpose): Promise<void> {
    await this.repository.update(
      { userId, purpose, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );
  }
}
