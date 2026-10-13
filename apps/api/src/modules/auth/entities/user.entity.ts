import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Internal user of the WCIES back office.
 * Passwords are Argon2 hashes - never plaintext or reversible (AGENTS.md / S0 §31).
 */
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  username!: string;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  email!: string | null;

  @Column({ type: 'text', name: 'password_hash' })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'varchar', length: 20, default: 'ADMIN' })
  role!: string;

  /** NULL until the mailbox is proven via a verification email link. */
  @Column({ type: 'timestamptz', name: 'email_verified_at', nullable: true })
  emailVerifiedAt!: Date | null;

  /** Session revocation ground: JWTs issued before this instant are stale. */
  @Column({ type: 'timestamptz', name: 'password_changed_at', default: () => 'now()' })
  passwordChangedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
