import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PlatformReturnEntity } from '../entities/platform-return.entity';
import { PlatformReturnRaw } from '@wcies/platform-contracts';

/**
 * Data access for platform return records (dual-axis T5). Upserts are
 * compare-and-write: an unchanged record writes nothing (zero-churn
 * idempotency, same rule as order platform facts).
 */
@Injectable()
export class PlatformReturnRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findByStoreAndReturnId(
    storeId: string,
    platformReturnId: string,
  ): Promise<PlatformReturnEntity | null> {
    return this.dataSource
      .getRepository(PlatformReturnEntity)
      .findOneBy({ storeId, platformReturnId });
  }

  /** 该店已落库的退货条数（0 = 首次同步，用来跳过一次提醒风暴）。 */
  async countByStore(storeId: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT COUNT(*)::text AS total FROM platform_returns WHERE store_id = $1`,
      [storeId],
    );
    return Number(rows[0]?.total ?? '0');
  }

  async insert(
    row: {
      storeId: string;
      platformReturnId: string;
      platformOrderId: string | null;
      orderId: string | null;
      state: string | null;
      refundState: string | null;
      platformSkuId: string | null;
      offerId: string | null;
      quantity: string;
      platformCreatedAt: Date | null;
      rawData: Record<string, unknown> | null;
    },
    manager?: EntityManager,
  ): Promise<PlatformReturnEntity> {
    const repository = (manager ?? this.dataSource).getRepository(PlatformReturnEntity);
    return repository.save(repository.create(row));
  }

  async updateFacts(
    id: string,
    patch: {
      platformOrderId?: string | null;
      orderId?: string | null;
      state?: string | null;
      refundState?: string | null;
      rawData?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const update: Record<string, unknown> = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        update[key] = value;
      }
    }
    await this.dataSource.getRepository(PlatformReturnEntity).update({ id }, update);
  }

  async list(filters: {
    storeId?: string;
    orderId?: string;
    linked?: boolean;
    /** 处理阶段：PENDING 待处理（未入批次）/ PROCESSING 处理中 / COMPLETED 已完结。 */
    stage?: 'PENDING' | 'PROCESSING' | 'COMPLETED';
    keyword?: string;
    limit: number;
    offset: number;
  }): Promise<{
    rows: PlatformReturnEntity[];
    total: number;
    enrichment: Map<
      string,
      {
        skuCode: string | null;
        skuName: string | null;
        batchNo: string | null;
        batchStatus: string | null;
      }
    >;
  }> {
    const qb = this.dataSource
      .getRepository(PlatformReturnEntity)
      .createQueryBuilder('r')
      .where('1 = 1');
    if (filters.storeId !== undefined) {
      qb.andWhere('r.store_id = :storeId', { storeId: filters.storeId });
    }
    if (filters.orderId !== undefined) {
      qb.andWhere('r.order_id = :orderId', { orderId: filters.orderId });
    }
    if (filters.linked === false) {
      // Pending-reconciliation view: platform records no batch line consumed.
      qb.andWhere(
        `NOT EXISTS (SELECT 1 FROM return_batch_items i WHERE i.platform_return_id = r.id)`,
      );
    } else if (filters.linked === true) {
      // 已入批次（2026-11-03）：被某个批次行消费过的记录。
      qb.andWhere(`EXISTS (SELECT 1 FROM return_batch_items i WHERE i.platform_return_id = r.id)`);
    }
    if (filters.stage !== undefined) {
      // 三段式（2026-11-04 用户口径）：待处理 = 未入批次；处理中 = 已入批次
      // 且批次未完结；已完结 = 所属批次已 COMPLETED。
      if (filters.stage === 'PENDING') {
        qb.andWhere(
          `NOT EXISTS (SELECT 1 FROM return_batch_items i WHERE i.platform_return_id = r.id)`,
        );
      } else {
        const status = filters.stage === 'PROCESSING' ? "'DRAFT','RECEIVED'" : "'COMPLETED'";
        qb.andWhere(
          `EXISTS (
             SELECT 1
               FROM return_batch_items i
               JOIN return_batches b ON b.id = i.batch_id
              WHERE i.platform_return_id = r.id AND b.status IN (${status})
           )`,
        );
      }
    }
    if (filters.keyword !== undefined && filters.keyword.trim() !== '') {
      const kw = `%${filters.keyword.trim()}%`;
      qb.andWhere(
        `(r.platform_return_id ILIKE :kw
          OR COALESCE(r.platform_order_id, '') ILIKE :kw
          OR COALESCE(r.offer_id, '') ILIKE :kw
          OR COALESCE(r.platform_sku_id, '') ILIKE :kw)`,
        { kw },
      );
    }
    qb.orderBy('r.createdAt', 'DESC').skip(filters.offset).take(filters.limit);
    const [rows, total] = await qb.getManyAndCount();
    return { rows, total, enrichment: await this.enrich(rows) };
  }

  /**
   * 商品明细与对账进度（2026-11-03）：列表上只显示订单号时运营无法判断
   * 「这条退货是什么货、还要不要处理」。内部 SKU 按店铺解析平台 SKU
   * （与下单同源规则），已入批次取最近一条消费该记录的批次号。
   */
  private async enrich(rows: PlatformReturnEntity[]): Promise<
    Map<
      string,
      {
        skuCode: string | null;
        skuName: string | null;
        batchNo: string | null;
        batchStatus: string | null;
      }
    >
  > {
    const map = new Map<
      string,
      {
        skuCode: string | null;
        skuName: string | null;
        batchNo: string | null;
        batchStatus: string | null;
      }
    >();
    if (rows.length === 0) {
      return map;
    }
    const result = await this.dataSource.query<
      Array<{
        id: string;
        sku_code: string | null;
        sku_name: string | null;
        batch_no: string | null;
        batch_status: string | null;
      }>
    >(
      `SELECT r.id,
              sku.sku_code,
              sku.name_zh AS sku_name,
              bt.batch_no,
              bt.batch_status
         FROM platform_returns r
         LEFT JOIN LATERAL (
                SELECT s.sku_code, s.name_zh
                  FROM platform_listing_skus pls
                  JOIN platform_listings pl ON pl.id = pls.listing_id
                  JOIN skus s ON s.id = pls.sku_id
                 WHERE pl.store_id = r.store_id
                   AND pls.platform_sku_id = r.platform_sku_id
                 LIMIT 1) sku ON TRUE
         LEFT JOIN LATERAL (
                SELECT b.batch_no, b.status AS batch_status
                  FROM return_batch_items i
                  JOIN return_batches b ON b.id = i.batch_id
                 WHERE i.platform_return_id = r.id
                 ORDER BY b.created_at DESC
                 LIMIT 1) bt ON TRUE
        WHERE r.id = ANY($1::uuid[])`,
      [rows.map((row) => row.id)],
    );
    for (const row of result) {
      map.set(row.id, {
        skuCode: row.sku_code,
        skuName: row.sku_name,
        batchNo: row.batch_no,
        batchStatus: row.batch_status,
      });
    }
    return map;
  }

  async findById(id: string): Promise<PlatformReturnEntity | null> {
    return this.dataSource.getRepository(PlatformReturnEntity).findOneBy({ id });
  }

  /** Raw shape adapter for sync upserts. */
  static toRow(input: PlatformReturnRaw, storeId: string) {
    return {
      storeId,
      platformReturnId: input.platformReturnId,
      platformOrderId: input.platformOrderId,
      orderId: null,
      state: input.state,
      refundState: input.refundState,
      platformSkuId: input.platformSkuId,
      offerId: input.offerId,
      quantity: input.quantity,
      platformCreatedAt: input.createdAt,
      rawData: input.rawData,
    };
  }
}
