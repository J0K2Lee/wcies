import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ExceptionSeverity, ExceptionStatus, ExceptionType } from '../enums/exception.constants';

/**
 * Unified exception center (Sprint 3 task §25-§27).
 *
 * Exceptions are business facts: never physically deleted, only closed via
 * RESOLVED / IGNORED. One OPEN row per (type, reference) is enforced by the
 * partial unique index uq_system_exceptions_open.
 */
@Entity('system_exceptions')
@Index('uq_system_exceptions_no', ['exceptionNo'], { unique: true })
@Index('idx_system_exceptions_status', ['status'])
@Index('idx_system_exceptions_reference', ['referenceType', 'referenceId'])
@Index('idx_system_exceptions_store', ['storeId'])
@Index('idx_system_exceptions_type', ['exceptionType'])
export class SystemExceptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30, name: 'exception_no' })
  exceptionNo!: string;

  @Column({ type: 'varchar', length: 60, name: 'exception_type' })
  exceptionType!: ExceptionType;

  @Column({ type: 'varchar', length: 20, default: 'HIGH' })
  severity!: ExceptionSeverity;

  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status!: ExceptionStatus;

  @Column({ type: 'varchar', length: 40, name: 'reference_type' })
  referenceType!: string;

  @Column({ type: 'uuid', name: 'reference_id' })
  referenceId!: string;

  @Column({ type: 'uuid', name: 'store_id', nullable: true })
  storeId!: string | null;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', name: 'resolved_at', nullable: true })
  resolvedAt!: Date | null;
}
