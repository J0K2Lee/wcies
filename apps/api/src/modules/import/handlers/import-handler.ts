import { ImportRowError } from '../entities/import-job.entity';
import { OperatorContext } from '../../operation-log/operation-log.service';

/** A validated row ready for import, tagged with its Excel row number. */
export interface ValidRow {
  rowNumber: number;
  data: Record<string, unknown>;
}

/** Execution context handed to importRow so rows can build stable keys. */
export interface ImportRowContext {
  jobId: string;
  rowNumber: number;
}

/**
 * Per-template import handler (task §57-§61): parse -> validate (exact
 * row/field/code errors) -> importRow. Duplicate unique keys are REJECTED,
 * never silently updated.
 *
 * importRow receives the jobId + rowNumber so templates like
 * INITIAL_INVENTORY can derive stable idempotency keys
 * `INITIAL_INVENTORY:<importJobId>:<rowNumber>` (Sprint 2 task §47) -
 * worker retries must never double-apply a row.
 */
export interface ImportHandler {
  readonly type: string;
  validate(
    rows: Array<{ rowNumber: number; cells: Record<string, string> }>,
  ): Promise<{ validRows: ValidRow[]; errors: ImportRowError[] }>;
  importRow(
    row: Record<string, unknown>,
    operator: OperatorContext,
    context: ImportRowContext,
  ): Promise<void>;
}
