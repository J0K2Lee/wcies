import { Injectable, Logger } from '@nestjs/common';
import { OperationLogEntity } from './entities/operation-log.entity';
import { OperationLogRepository } from './repositories/operation-log.repository';

/** Who performed an operation - taken from the JWT session by controllers. */
export interface OperatorContext {
  userId: string | null;
  username: string;
}

/** Field-level diff; values must never include secrets (AGENTS.md §29). */
export type OperationChanges = Record<string, { from: unknown; to: unknown }>;

/**
 * Audit writer for master-data changes (Sprint 1 task §62).
 *
 * Logging is best-effort AFTER the business write: an audit failure must not
 * roll back an already-committed master-data change, but it is logged loudly
 * so a silent audit gap never goes unnoticed.
 */
@Injectable()
export class OperationLogService {
  private readonly logger = new Logger(OperationLogService.name);

  constructor(private readonly repository: OperationLogRepository) {}

  async record(
    entry: Pick<
      OperationLogEntity,
      'entityType' | 'entityId' | 'action' | 'entityCode' | 'changes'
    > & { operator?: OperatorContext | null },
  ): Promise<void> {
    try {
      await this.repository.insert({
        entityType: entry.entityType,
        entityId: entry.entityId,
        entityCode: entry.entityCode,
        action: entry.action,
        operatorId: entry.operator?.userId ?? null,
        operatorName: entry.operator?.username ?? 'system',
        changes: entry.changes,
      });
    } catch (error: unknown) {
      this.logger.error(
        `operation log write failed for ${entry.entityType}/${entry.entityId}: ${String(error)}`,
      );
    }
  }
}

/** Computes a field-level diff between two plain snapshots. */
export function diffOf(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): OperationChanges {
  const changes: OperationChanges = {};
  for (const key of Object.keys(after)) {
    const from = before[key] ?? null;
    const to = after[key] ?? null;
    if (from !== to) {
      changes[key] = { from, to };
    }
  }
  return changes;
}
