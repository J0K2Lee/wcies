import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Reusable supplier master data (Sprint 7 task §9, decision 0013 §3).
 *
 * Only genuinely reusable vendors belong here; one-off online purchases use
 * the documents' free-text source_note. OPTIONAL on purchase orders and
 * receipts - never a required field.
 */
@Entity('suppliers')
@Index('idx_suppliers_name', ['name'])
export class SupplierEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Business code SUP%04d (centralized sequence, master-data.md §1). */
  @Column({ type: 'varchar', length: 50, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 100, name: 'contact_name', nullable: true })
  contactName!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'contact_phone', nullable: true })
  contactPhone!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

export const SUPPLIER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];
