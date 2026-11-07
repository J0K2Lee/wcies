import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { ExternalRawEventEntity } from '../entities/external-raw-event.entity';
import { RawEventStatus } from '../sync.constants';

/** Data access only - no business rules here (AGENTS.md §8). */
@Injectable()
export class ExternalRawEventRepository {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ExternalRawEventEntity)
    private readonly repository: Repository<ExternalRawEventEntity>,
  ) {}

  /**
   * 该店铺最近一次收到任何平台推送的时间（含探测 PING，2026-11-07）。
   * 用于「静默看门狗」：enabled 的订阅长时间没有任何入站请求 = 投递链路中断，
   * 这比等平台把订阅暂停更早暴露问题（10-30/10-31 的实证）。
   */
  async findLastReceivedAt(storeId: string): Promise<Date | null> {
    const rows = await this.dataSource.query<Array<{ last: Date | null }>>(
      `SELECT MAX(received_at) AS last FROM external_raw_events WHERE store_id = $1::uuid`,
      [storeId],
    );
    const last = rows[0]?.last ?? null;
    return last === null ? null : new Date(last);
  }

  /** Stable hash for idempotency (task §27): sorted-key canonical JSON. */
  static payloadHash(payload: Record<string, unknown>): string {
    const canonical = canonicalJson(payload);
    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Dedup insert (task §27):
   * - platform event id present -> dedup by (store_id, external_event_id);
   * - otherwise -> dedup by (store_id, payload_hash).
   * Returns null when an identical event was already stored.
   */
  async insertIfNew(input: {
    platform: string;
    storeId: string;
    eventType: string;
    externalEventId: string | null;
    payload: Record<string, unknown>;
    status: RawEventStatus;
    /**
     * 拒绝原因（2026-10-22）：身份不匹配类拒绝必须留下可读原因，否则同步
     * 中心只显示「已拒绝」无法自诊断（Yandex 事件就因此查不出是 campaignId
     * 对不上）。内容不得含密文（AGENTS.md §29）。
     */
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<ExternalRawEventEntity | null> {
    const payloadHash = ExternalRawEventRepository.payloadHash(input.payload);
    if (input.externalEventId !== null) {
      const existing = await this.repository.findOneBy({
        storeId: input.storeId,
        externalEventId: input.externalEventId,
      });
      if (existing !== null) {
        return null;
      }
    }
    const result = await this.dataSource.query<Array<{ id: string }>>(
      `INSERT INTO external_raw_events
         (platform, store_id, event_type, external_event_id, payload, payload_hash, status,
          error_code, error_message)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
       ON CONFLICT (store_id, payload_hash) DO NOTHING
       RETURNING id`,
      [
        input.platform,
        input.storeId,
        input.eventType,
        input.externalEventId,
        JSON.stringify(input.payload),
        payloadHash,
        input.status,
        input.errorCode ?? null,
        input.errorMessage ?? null,
      ],
    );
    const inserted = result[0];
    if (inserted === undefined) {
      return null;
    }
    return this.repository.findOneBy({ id: inserted.id });
  }

  async findById(id: string): Promise<ExternalRawEventEntity | null> {
    return this.repository.findOneBy({ id });
  }

  async markStatus(
    id: string,
    status: RawEventStatus,
    patch?: { errorCode?: string | null; errorMessage?: string | null },
  ): Promise<void> {
    const terminal = status !== 'PENDING' && status !== 'PROCESSING';
    await this.repository.update(
      { id },
      {
        status,
        errorCode: patch?.errorCode ?? null,
        errorMessage: patch?.errorMessage ?? null,
        processedAt: terminal ? new Date() : null,
      },
    );
  }

  async list(
    filters: { storeId?: string; status?: string },
    limit: number,
    offset: number,
  ): Promise<{ rows: ExternalRawEventEntity[]; total: number }> {
    const qb = this.repository.createQueryBuilder('event');
    if (filters.storeId !== undefined) {
      qb.andWhere('event.store_id = :storeId', { storeId: filters.storeId });
    }
    if (filters.status !== undefined) {
      qb.andWhere('event.status = :status', { status: filters.status });
    }
    qb.orderBy('event.received_at', 'DESC').skip(offset).take(limit);
    const [rows, total] = await Promise.all([qb.getMany(), qb.getCount()]);
    return { rows, total };
  }
}

/** Deterministic JSON: object keys sorted recursively (task §27 stability). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
