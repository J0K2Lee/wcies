import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncCursorEntity } from '../entities/sync-cursor.entity';
import { SyncType } from '../sync.constants';

/** Data access only - no business rules here (AGENTS.md §8). */
@Injectable()
export class SyncCursorRepository {
  constructor(
    @InjectRepository(SyncCursorEntity)
    private readonly repository: Repository<SyncCursorEntity>,
  ) {}

  async find(storeId: string, syncType: SyncType): Promise<SyncCursorEntity | null> {
    return this.repository.findOneBy({ storeId, syncType });
  }

  async cursorData(storeId: string, syncType: SyncType): Promise<Record<string, unknown> | null> {
    const row = await this.find(storeId, syncType);
    return row?.cursorData ?? null;
  }

  async upsert(input: {
    storeId: string;
    syncType: SyncType;
    cursorData?: Record<string, unknown> | null;
    lastSuccessAt?: Date;
    resetFailures?: boolean;
    incrementFailures?: boolean;
  }): Promise<void> {
    const existing = await this.find(input.storeId, input.syncType);
    if (existing === null) {
      await this.repository.insert({
        storeId: input.storeId,
        syncType: input.syncType,
        cursorData: input.cursorData ?? null,
        lastSuccessAt: input.lastSuccessAt ?? null,
        consecutiveFailures: input.incrementFailures === true ? 1 : 0,
      } as never);
      return;
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.cursorData !== undefined) {
      patch.cursorData = input.cursorData;
    }
    if (input.lastSuccessAt !== undefined) {
      patch.lastSuccessAt = input.lastSuccessAt;
    }
    if (input.resetFailures === true) {
      patch.consecutiveFailures = 0;
    } else if (input.incrementFailures === true) {
      patch.consecutiveFailures = existing.consecutiveFailures + 1;
    }
    await this.repository.update({ id: existing.id }, patch);
  }
}
