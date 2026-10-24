import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { SystemExceptionEntity } from '../entities/system-exception.entity';
import { ExceptionSeverity, ExceptionStatus, ExceptionType } from '../enums/exception.constants';
import { ExceptionNotFoundError, ExceptionStateInvalidError } from '../errors/exception.errors';
import {
  ExceptionListFilters,
  SystemExceptionRepository,
} from '../repositories/system-exception.repository';

export interface ExceptionDto {
  id: string;
  exceptionNo: string;
  exceptionType: string;
  severity: string;
  status: string;
  referenceType: string;
  referenceId: string;
  storeId: string | null;
  message: string;
  details: Record<string, unknown> | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface CreateExceptionInput {
  exceptionType: ExceptionType;
  severity?: ExceptionSeverity;
  referenceType: string;
  referenceId: string;
  storeId?: string | null;
  message: string;
  details?: Record<string, unknown> | null;
}

/**
 * Minimal exception center (Sprint 3 task §25-§27).
 *
 * Creation is deduplicated per (type, reference): while an OPEN row exists a
 * repeat call is a no-op returning that row, so backorder retries never
 * create exception spam. Exceptions are never deleted - only RESOLVED /
 * IGNORED. createInTx lets the caller keep the exception in the SAME
 * transaction as the business fact it describes.
 */
@Injectable()
export class ExceptionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: SystemExceptionRepository,
  ) {}

  /** Creates the exception in its own transaction. */
  async create(input: CreateExceptionInput): Promise<ExceptionDto> {
    return this.dataSource.transaction(async (manager) => this.createInTx(manager, input));
  }

  /**
   * Creates (or returns the existing OPEN row for) the exception on the
   * caller's transaction - used by order ingestion so an item's status and
   * its exception commit atomically.
   */
  async createInTx(manager: EntityManager, input: CreateExceptionInput): Promise<ExceptionDto> {
    const existing = await this.repository.findOpenByReferenceTx(
      manager,
      input.exceptionType,
      input.referenceType,
      input.referenceId,
    );
    if (existing !== null) {
      return this.toDto(existing);
    }
    const exceptionNo = await this.repository.nextExceptionNo(manager);
    const created = await this.repository.insert(manager, {
      exceptionNo,
      exceptionType: input.exceptionType,
      severity: input.severity ?? 'HIGH',
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      storeId: input.storeId ?? null,
      message: input.message,
      details: input.details ?? null,
    });
    return this.toDto(created);
  }

  async resolve(id: string, operator: OperatorContext, remark?: string): Promise<ExceptionDto> {
    return this.close(id, 'RESOLVED', operator, remark);
  }

  async ignore(id: string, operator: OperatorContext, remark?: string): Promise<ExceptionDto> {
    return this.close(id, 'IGNORED', operator, remark);
  }

  private async close(
    id: string,
    target: ExceptionStatus,
    operator: OperatorContext,
    remark?: string,
  ): Promise<ExceptionDto> {
    return this.dataSource.transaction(async (manager) => {
      const exception = await this.repository.lockById(manager, id);
      if (exception === null) {
        throw new ExceptionNotFoundError(id);
      }
      if (exception.status !== 'OPEN') {
        throw new ExceptionStateInvalidError(id, exception.status);
      }
      if (remark !== undefined && remark !== '') {
        exception.details = {
          ...(exception.details ?? {}),
          closedBy: operator.username,
          closeRemark: remark,
        };
      }
      await this.repository.updateStatus(manager, id, {
        status: target,
        resolvedAt: new Date(),
      });
      return this.toDto({ ...exception, status: target, resolvedAt: new Date() });
    });
  }

  /** Closes the OPEN exception of a reference on the caller's transaction. */
  async resolveByReferenceInTx(
    manager: EntityManager,
    input: { exceptionType: string; referenceType: string; referenceId: string },
  ): Promise<void> {
    const existing = await this.repository.findOpenByReferenceTx(
      manager,
      input.exceptionType,
      input.referenceType,
      input.referenceId,
    );
    if (existing === null) {
      return;
    }
    await this.repository.updateStatus(manager, existing.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(),
    });
  }

  /**
   * 删除某订单（含其订单行）的异常记录——用于「错误摄入订单彻底移除」
   * （2026-10-24）：异常只属于那张单，留着会指向已删除的订单。
   */
  async deleteByReferenceInTx(
    manager: EntityManager,
    input: { orderId: string; orderItemIds: readonly string[] },
  ): Promise<void> {
    await manager.query(
      `DELETE FROM system_exceptions
        WHERE (reference_type = 'ORDER' AND reference_id = $1::uuid)
           OR (reference_type = 'ORDER_ITEM' AND reference_id = ANY($2::uuid[]))`,
      [input.orderId, [...input.orderItemIds]],
    );
  }

  /** Own-transaction variant of resolveByReferenceInTx for standalone flows. */
  async resolveByReference(input: {
    exceptionType: string;
    referenceType: string;
    referenceId: string;
  }): Promise<void> {
    await this.dataSource.transaction(async (manager) =>
      this.resolveByReferenceInTx(manager, input),
    );
  }

  /**
   * Create-or-refresh the single OPEN exception of a reference (Sprint 9 T2
   * SYNC_FAILED): same dedup as create(), but a repeat call with a CHANGED
   * message/details rewrites the open row instead of returning stale text -
   * the failure picture must stay current while the condition persists.
   */
  async upsertOpen(input: CreateExceptionInput): Promise<ExceptionDto> {
    return this.dataSource.transaction(async (manager) => {
      const existing = await this.repository.findOpenByReferenceTx(
        manager,
        input.exceptionType,
        input.referenceType,
        input.referenceId,
      );
      if (existing !== null) {
        await this.repository.updateOpenMessageDetails(manager, existing.id, {
          message: input.message,
          details: input.details ?? null,
        });
        return this.toDto({
          ...existing,
          message: input.message,
          details: input.details ?? null,
        });
      }
      return this.createInTx(manager, input);
    });
  }

  async list(
    filters: ExceptionListFilters,
    page: { page: number; pageSize: number },
  ): Promise<{ items: ExceptionDto[]; meta: PageMeta }> {
    const { rows, total } = await this.repository.list(
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    return {
      items: rows.map((row) => this.toDto(row)),
      meta: { page: page.page, pageSize: page.pageSize, total },
    };
  }

  async findById(id: string): Promise<ExceptionDto> {
    const exception = await this.repository.findById(id);
    if (exception === null) {
      throw new ExceptionNotFoundError(id);
    }
    return this.toDto(exception);
  }

  /** Batch OPEN-exception DTOs for order detail views. */
  async listByReference(referenceType: string, referenceId: string): Promise<ExceptionDto[]> {
    const { rows } = await this.repository.list({ referenceType, referenceId }, 100, 0);
    return rows.map((row) => this.toDto(row));
  }

  /** OPEN count per reference for list badges (task §61 Exceptions column). */
  async countOpenByReferences(
    referenceType: string,
    referenceIds: string[],
  ): Promise<Map<string, number>> {
    return this.repository.countOpenByReferences(referenceType, referenceIds);
  }

  private toDto(entity: SystemExceptionEntity): ExceptionDto {
    return {
      id: entity.id,
      exceptionNo: entity.exceptionNo,
      exceptionType: entity.exceptionType,
      severity: entity.severity,
      status: entity.status,
      referenceType: entity.referenceType,
      referenceId: entity.referenceId,
      storeId: entity.storeId,
      message: entity.message,
      details: entity.details,
      createdAt: entity.createdAt,
      resolvedAt: entity.resolvedAt,
    };
  }
}
