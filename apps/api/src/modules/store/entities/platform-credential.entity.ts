import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Encrypted API credential of a store (task §11/§12). Strictly separated
 * from the store itself. `encryptedPayload` stores the JSON serialization of
 * EncryptedCredential (AES-256-GCM) - it is NEVER returned by any API and
 * never written to logs or the operation log.
 */
@Entity('platform_credentials')
@Index('uq_platform_credentials_store_type', ['storeId', 'credentialType'], { unique: true })
export class PlatformCredentialEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  @Column({ type: 'varchar', length: 50, name: 'credential_type' })
  credentialType!: string;

  @Column({ type: 'text', name: 'encrypted_payload' })
  encryptedPayload!: string;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  /** Validation metadata (Sprint 5 §33); error text is sanitized, never secret. */
  @Column({ type: 'timestamptz', name: 'last_validated_at', nullable: true })
  lastValidatedAt!: Date | null;

  @Column({ type: 'varchar', length: 20, name: 'last_validation_status', nullable: true })
  lastValidationStatus!: string | null;

  @Column({ type: 'text', name: 'last_validation_error', nullable: true })
  lastValidationError!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
