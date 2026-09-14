import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { SystemExceptionEntity } from '../entities/system-exception.entity';

export interface ExceptionListFilters {
  exceptionType?: string;
  status?: string;
  referenceType?: string;
  referenceId?: string;
  storeId?: string;
}

/** Data access for the exception center (queries + inserts + closes; no deletes). */
@Injectable()
export class SystemExceptionRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Business number from the dedicated PG sequence: EXC000001... */
  async nextExceptionNo(manager: EntityManager): Promise<string> {
    const result = await manager.query<Array<{ no: string }>>(
      `SELECT nextval('system_exception_no_seq') AS no`,
    );
    return `EXC${result[0]!.no.padStart(8, '0')}`;
  }

  async insert(
    manager: EntityManager,
    row: {
      exceptionNo: string;
      exceptionType: string;
      severity: string;
      referenceType: string;
      referenceId: string;
      storeId: string | null;
      message: string;
      details: Record<string, unknown> | null;
    },
  ): Promise<SystemExceptionEntity> {
    const repository = manager.getRepository(SystemExceptionEntity);
    const created = (await repository.save(
      repository.create({ ...row, status: 'OPEN' } as never),
    )) as unknown as SystemExceptionEntity;
    return created;
  }

  async updateStatus(
    manager: EntityManager,
    id: string,
    patch: Partial<Pick<SystemExceptionEntity, 'status' | 'resolvedAt'>>,
  ): Promise<void> {
    await manager
      .getRepository(SystemExceptionEntity)
      .update({ id }, { ...patch, updatedAt: new Date() });
  }

  /**
   * Refreshes message + details of an OPEN row (Sprint 9 T2 SYNC_FAILED):
   * the dedup key stays unique per (type, reference), so a changed failure
   * picture updates the ONE open row instead of piling up new ones.
   */
  async updateOpenMessageDetails(
    manager: EntityManager,
    id: string,
    patch: { message: string; details: Record<string, unknown> | null },
  ): Promise<void> {
    await manager
      .getRepository(SystemExceptionEntity)
      .update({ id }, { ...patch, updatedAt: new Date() } as never);
  }

  /** In-transaction OPEN-row check for idempotent creation (no spam, task §24). */
  async findOpenByReferenceTx(
    manager: EntityManager,
    exceptionType: string,
    referenceType: string,
    referenceId: string,
  ): Promise<SystemExceptionEntity | null> {
    return manager.getRepository(SystemExceptionEntity).findOneBy({
      exceptionType: exceptionType as never,
      referenceType,
      referenceId,
      status: 'OPEN',
    });
  }

  async findOpenByReference(
    exceptionType: string,
    referenceType: string,
    referenceId: string,
  ): Promise<SystemExceptionEntity | null> {
    return this.dataSource.getRepository(SystemExceptionEntity).findOneBy({
      exceptionType: exceptionType as never,
      referenceType,
      referenceId,
      status: 'OPEN',
    });
  }

  async findById(id: string): Promise<SystemExceptionEntity | null> {
    return this.dataSource.getRepository(SystemExceptionEntity).findOneBy({ id });
  }

  async lockById(manager: EntityManager, id: string): Promise<SystemExceptionEntity | null> {
    return manager
      .getRepository(SystemExceptionEntity)
      .createQueryBuilder('e')
      .where('e.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }

  async list(
    filters: ExceptionListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: SystemExceptionEntity[]; total: number }> {
    const qb = this.dataSource.getRepository(SystemExceptionEntity).createQueryBuilder('e');
    if (filters.exceptionType !== undefined) {
      qb.andWhere('e.exceptionType = :exceptionType', { exceptionType: filters.exceptionType });
    }
    if (filters.status !== undefined) {
      qb.andWhere('e.status = :status', { status: filters.status });
    }
    if (filters.referenceType !== undefined) {
      qb.andWhere('e.referenceType = :referenceType', { referenceType: filters.referenceType });
    }
    if (filters.referenceId !== undefined) {
      qb.andWhere('e.referenceId = :referenceId', { referenceId: filters.referenceId });
    }
    if (filters.storeId !== undefined) {
      qb.andWhere('e.storeId = :storeId', { storeId: filters.storeId });
    }
    qb.orderBy('e.createdAt', 'DESC').skip(offset).take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return { rows, total };
  }

  /** OPEN exception counts keyed by reference id (order list badges, no N+1). */
  async countOpenByReferences(
    referenceType: string,
    referenceIds: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (referenceIds.length === 0) {
      return out;
    }
    const rows = await this.dataSource.query<Array<{ reference_id: string; cnt: string }>>(
      `SELECT reference_id AS reference_id, COUNT(*) AS cnt
         FROM system_exceptions
        WHERE status = 'OPEN' AND reference_type = $1 AND reference_id = ANY($2::uuid[])
        GROUP BY reference_id`,
      [referenceType, referenceIds],
    );
    for (const row of rows) {
      out.set(row.reference_id, Number(row.cnt));
    }
    return out;
  }
}
