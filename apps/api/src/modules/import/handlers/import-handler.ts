import { ImportRowError } from '../entities/import-job.entity';
import { OperatorContext } from '../../operation-log/operation-log.service';

/** A validated row ready for import, tagged with its Excel row number. */
export interface ValidRow {
  rowNumber: number;
  data: Record<string, unknown>;
}

/**
 * Per-template import handler (task §57-§61): parse -> validate (exact
 * row/field/code errors) -> importRow. Duplicate unique keys are REJECTED,
 * never silently updated.
 */
export interface ImportHandler {
  readonly type: string;
  validate(
    rows: Array<{ rowNumber: number; cells: Record<string, string> }>,
  ): Promise<{ validRows: ValidRow[]; errors: ImportRowError[] }>;
  importRow(row: Record<string, unknown>, operator: OperatorContext): Promise<void>;
}
