import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Row-level error with exact Excel row number (task §60). */
export interface ImportRowError {
  row: number;
  field?: string;
  code: string;
  message: string;
}

export const IMPORT_TYPES = [
  'SKU',
  'BARCODE',
  'WAREHOUSE',
  'BIN',
  'LISTING_MAPPING',
  'INITIAL_INVENTORY',
] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export const IMPORT_STATUSES = [
  'VALIDATED',
  'PENDING_IMPORT',
  'IMPORTING',
  'COMPLETED',
  'FAILED',
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/**
 * One fixed-template Excel import (task §57-§61).
 * Flow: Upload -> parse+validate (sync, report per-row errors) -> Confirm ->
 * BullMQ worker imports valid rows. Duplicate business keys are REJECTED,
 * never silently updated (task §61). The uploaded file is kept in object
 * storage for traceability; parsed valid rows are stored in rows_data so the
 * worker never re-parses the sheet.
 */
@Entity('import_jobs')
export class ImportJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, name: 'import_type' })
  importType!: ImportType;

  @Column({ type: 'varchar', length: 30 })
  status!: ImportStatus;

  @Column({ type: 'text', name: 'object_key' })
  objectKey!: string;

  @Column({ type: 'varchar', length: 255, name: 'original_filename' })
  originalFilename!: string;

  @Column({ type: 'integer', name: 'total_rows', default: 0 })
  totalRows!: number;

  @Column({ type: 'integer', name: 'valid_rows', default: 0 })
  validRows!: number;

  @Column({ type: 'integer', name: 'invalid_rows', default: 0 })
  invalidRows!: number;

  @Column({ type: 'integer', name: 'imported_rows', default: 0 })
  importedRows!: number;

  @Column({ type: 'integer', name: 'failed_rows', default: 0 })
  failedRows!: number;

  @Column({ type: 'jsonb', nullable: true })
  errors!: ImportRowError[] | null;

  /** Parsed + validated rows handed to the import worker. */
  @Column({ type: 'jsonb', name: 'rows_data', nullable: true })
  rowsData!: Record<string, unknown>[] | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'created_by_name', nullable: true })
  createdByName!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', name: 'imported_at', nullable: true })
  importedAt!: Date | null;
}
