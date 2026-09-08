import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain.error';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ObjectStorageService } from '../../infrastructure/storage/object-storage.service';
import {
  ImportJobEntity,
  ImportRowError,
  ImportType,
  IMPORT_TYPES,
} from './entities/import-job.entity';
import { ImportJobRepository } from './repositories/import-job.repository';
import { parseFixedTemplateSheet } from './services/excel-parser';
import { ImportHandler } from './handlers/import-handler';
import { ImportJobResponseDto } from './dto/import.dto';
import { SkuImportHandler } from './handlers/sku-import.handler';
import {
  BarcodeImportHandler,
  BinImportHandler,
  WarehouseImportHandler,
} from './handlers/master-data-import.handlers';
import { ListingMappingImportHandler } from './handlers/listing-mapping-import.handler';
import { InitialInventoryImportHandler } from './handlers/initial-inventory-import.handler';
import { QUEUE_NAMES } from '../../infrastructure/queue/queue.constants';
import { OperatorContext } from '../operation-log/operation-log.service';

export class ImportTypeInvalidError extends DomainError {
  readonly code = 'IMPORT_TYPE_INVALID';
  readonly httpStatus = 422;
  constructor(importType: string) {
    super(`Unknown import type: ${importType}`, { importType });
  }
}

export class ImportJobNotFoundError extends DomainError {
  readonly code = 'IMPORT_JOB_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Import job not found: ${id}`, { id });
  }
}

export class ImportJobStateInvalidError extends DomainError {
  readonly code = 'IMPORT_JOB_STATE_INVALID';
  readonly httpStatus = 409;
  constructor(message: string) {
    super(message);
  }
}

/**
 * Import Center (task §57-§61).
 *
 * Upload validates synchronously (fixed templates, exact row/field/code
 * errors) and stores the report; the actual import runs on the BullMQ worker
 * after an explicit confirm (AGENTS.md §50). Duplicate business keys are
 * rejected - never silently overwritten.
 */
@Injectable()
export class ImportService {
  private readonly handlers = new Map<string, ImportHandler>();

  constructor(
    private readonly jobRepository: ImportJobRepository,
    private readonly objectStorage: ObjectStorageService,
    @InjectQueue(QUEUE_NAMES.import) private readonly importQueue: Queue,
    skuHandler: SkuImportHandler,
    barcodeHandler: BarcodeImportHandler,
    warehouseHandler: WarehouseImportHandler,
    binHandler: BinImportHandler,
    listingMappingHandler: ListingMappingImportHandler,
    initialInventoryHandler: InitialInventoryImportHandler,
  ) {
    for (const handler of [
      skuHandler,
      barcodeHandler,
      warehouseHandler,
      binHandler,
      listingMappingHandler,
      initialInventoryHandler,
    ]) {
      this.handlers.set(handler.type, handler);
    }
  }

  async uploadAndValidate(
    importType: string,
    file: { buffer: Buffer; originalFilename: string; size: number },
    operator: OperatorContext,
  ): Promise<ImportJobEntity> {
    if (!(IMPORT_TYPES as readonly string[]).includes(importType)) {
      throw new ImportTypeInvalidError(importType);
    }
    const handler = this.handlers.get(importType);
    if (handler === undefined) {
      throw new ImportTypeInvalidError(importType);
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new ImportJobStateInvalidError('文件超过 10MB 限制');
    }

    const { rows } = await parseFixedTemplateSheet(file.buffer);
    const { validRows, errors } = await handler.validate(rows);

    const job = await this.jobRepository.insert({
      importType: importType as ImportType,
      status: validRows.length > 0 ? 'VALIDATED' : 'FAILED',
      objectKey: 'pending',
      originalFilename: file.originalFilename,
      totalRows: rows.length,
      validRows: validRows.length,
      invalidRows: errors.length,
      importedRows: 0,
      failedRows: 0,
      errors,
      rowsData: validRows.map((row) => ({ rowNumber: row.rowNumber, ...row.data })),
      createdBy: operator.userId,
      createdByName: operator.username,
    });

    // Keep the uploaded file for traceability (task §59).
    const objectKey = `imports/${job.id}/${file.originalFilename}`;
    await this.objectStorage.upload({
      key: objectKey,
      body: file.buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await this.jobRepository.update(job.id, { objectKey });

    return (await this.jobRepository.findById(job.id)) as ImportJobEntity;
  }

  /** Enqueues the validated job for worker-side import; returns the job. */
  async confirm(id: string, operator: OperatorContext): Promise<ImportJobEntity> {
    const job = await this.getJobOrThrow(id);
    if (job.status !== 'VALIDATED') {
      throw new ImportJobStateInvalidError(`任务状态不允许导入: ${job.status}`);
    }
    if (job.validRows === 0) {
      throw new ImportJobStateInvalidError('没有可导入的有效行');
    }
    await this.jobRepository.update(id, { status: 'PENDING_IMPORT' });
    await this.importQueue.add('execute', {
      importJobId: id,
      operatorId: operator.userId,
      operatorName: operator.username,
    });
    return (await this.jobRepository.findById(id)) as ImportJobEntity;
  }

  async getById(id: string): Promise<ImportJobEntity> {
    return this.getJobOrThrow(id);
  }

  async list(
    filters: { importType?: string; status?: string },
    page: { page: number; pageSize: number },
  ): Promise<{ items: ImportJobEntity[]; total: number }> {
    const { rows, total } = await this.jobRepository.list(
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    return { items: rows, total };
  }

  handlerFor(importType: string): ImportHandler {
    const handler = this.handlers.get(importType);
    if (handler === undefined) {
      throw new ImportTypeInvalidError(importType);
    }
    return handler;
  }

  async getJobOrThrow(id: string): Promise<ImportJobEntity> {
    const job = await this.jobRepository.findById(id);
    if (job === null) {
      throw new ImportJobNotFoundError(id);
    }
    return job;
  }

  toResponse(job: ImportJobEntity): ImportJobResponseDto {
    return {
      id: job.id,
      importType: job.importType,
      status: job.status,
      originalFilename: job.originalFilename,
      totalRows: job.totalRows,
      validRows: job.validRows,
      invalidRows: job.invalidRows,
      importedRows: job.importedRows,
      failedRows: job.failedRows,
      errors: job.errors,
      createdBy: job.createdByName,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      importedAt: job.importedAt,
    };
  }
}

export type { ImportRowError };
