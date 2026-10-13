import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { EmailVerificationPurpose } from '../email-verification.constants';

/**
 * Single-use email verification token (invite / password change / email
 * change). Only the SHA-256 hash of the raw token is stored - the raw token
 * exists solely inside the email link (docs/business-rules/users.md).
 */
@Entity('email_verification_tokens')
@Index('idx_evt_user_purpose', ['userId', 'purpose'])
export class EmailVerificationTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 30 })
  purpose!: EmailVerificationPurpose;

  /** Mailbox the link was sent to (the email being proven). */
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 64, name: 'token_hash' })
  tokenHash!: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', name: 'consumed_at', nullable: true })
  consumedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
