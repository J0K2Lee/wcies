import { Injectable, Logger } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ImportRowError } from '../entities/import-job.entity';
import { ImportJobRepository } from '../repositories/import-job.repository';
import { ImportService } from '../import.service';

/**
 * Executes a validated import job on the worker (task §59 Confirm -> Import).
 *
 * Rows are imported independently: one failing row never rolls back the
 * others; failures are appended to the per-row error report with exact row
 * numbers (task §60/§61 - single bad rows must not sink the batch).
 */
@Injectable()
export class ImportExecutorService {
  private readonly logger = new Logger(ImportExecutorService.name);

  constructor(
    private readonly jobRepository: ImportJobRepository,
    private readonly importService: ImportService,
  ) {}

  async execute(jobId: string, operator: OperatorContext): Promise<void> {
    const job = await this.jobRepository.findById(jobId);
    if (job === null || job.status !== 'PENDING_IMPORT') {
      this.logger.warn(`import job skipped (missing or wrong state): ${jobId}`);
      return;
    }

    await this.jobRepository.update(jobId, { status: 'IMPORTING' });
    const handler = this.importService.handlerFor(job.importType);
    const rows = job.rowsData ?? [];

    const importErrors: ImportRowError[] = [...(job.errors ?? [])];
    let importedRows = 0;
    let failedRows = 0;

    for (const row of rows) {
      const rowNumber = Number(row['rowNumber'] ?? 0);
      const data = { ...row };
      delete data['rowNumber'];
      try {
        await handler.importRow(data, operator, { jobId, rowNumber });
        importedRows += 1;
      } catch (error: unknown) {
        failedRows += 1;
        const isDomain = error instanceof DomainError;
        importErrors.push({
          row: rowNumber,
          code: isDomain ? error.code : 'IMPORT_ROW_FAILED',
          message: isDomain ? error.message : String((error as Error)?.message ?? error),
        });
        this.logger.warn(
          `import row failed job=${jobId} row=${rowNumber}: ${(error as Error)?.message ?? error}`,
        );
      }
    }

    await this.jobRepository.update(jobId, {
      status: 'COMPLETED',
      importedRows,
      failedRows,
      errors: importErrors,
      importedAt: new Date(),
    });
    this.logger.log(
      `import job ${jobId} (${job.importType}) completed: imported=${importedRows} failed=${failedRows}`,
    );
  }
}
