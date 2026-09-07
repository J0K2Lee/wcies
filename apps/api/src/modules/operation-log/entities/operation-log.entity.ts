import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Append-only audit trail for master-data writes (Sprint 1 task §62).
 *
 * `changes` holds a field-level before/after diff produced by the writing
 * service. Credential entries NEVER contain secret material - the credential
 * service only records metadata (type/status/updatedAt).
 */
@Entity('operation_logs')
@Index('idx_operation_logs_entity', ['entityType', 'entityId'])
export class OperationLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, name: 'entity_type' })
  entityType!: string;

  @Column({ type: 'uuid', name: 'entity_id' })
  entityId!: string;

  @Column({ type: 'varchar', length: 255, name: 'entity_code', nullable: true })
  entityCode!: string | null;

  @Column({ type: 'varchar', length: 50 })
  action!: string;

  @Column({ type: 'uuid', name: 'operator_id', nullable: true })
  operatorId!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'operator_name' })
  operatorName!: string;

  @Column({ type: 'jsonb', nullable: true })
  changes!: Record<string, { from: unknown; to: unknown }> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
