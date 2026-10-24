/**
 * 一次性回填：给「快速建档时没拿到图」的 WB / Yandex SKU 补回商品主图
 * （2026-10-24）。
 *
 * 背景：建档取图此前只读变体 raw_data 里的 OZON 字段（`color_image` /
 * `primary_image`），WB 的图在商品链接 `photos[]`、Yandex 的在 `offer.pictures[]`，
 * 所以这两个平台建档后 `sku_images` 一直是空的。代码已修（按平台取图），本脚本
 * 把存量补上：找出「已映射、但一张图都没有」的 WB/Yandex SKU，用同一套解析
 * 逻辑算出图片 URL，重新入队（jobId 按 SKU 幂等，处理器本身会跳过已有图）。
 *
 * 默认 DRY RUN；`--apply` 才真正入队。
 *
 * Usage:
 *   tsx apps/api/scripts/backfill-onboard-sku-images-2026-10-24.ts
 *   tsx apps/api/scripts/backfill-onboard-sku-images-2026-10-24.ts --apply
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('拒绝在 production 环境执行（AGENTS §93）');
  }
  const apply = process.argv.includes('--apply');
  const { NestFactory } = await import('@nestjs/core');
  const { DataSource } = await import('typeorm');
  const { AppModule } = await import('../dist/app.module.js');
  const { resolveOnboardImageUrl } =
    await import('../dist/modules/listing/services/listing-onboarding.service.js');
  const { SkuImageImportService } =
    await import('../dist/modules/product/services/sku-image-import.service.js');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const ds = app.get(DataSource);
    const importService = app.get(SkuImageImportService);

    const rows = await ds.query<
      Array<{
        id: string;
        sku_code: string;
        platform: string;
        variant_raw: Record<string, unknown> | null;
        listing_raw: Record<string, unknown> | null;
      }>
    >(`
      SELECT s.id, s.sku_code, p.code AS platform, pls.raw_data AS variant_raw, pl.raw_data AS listing_raw
        FROM skus s
        JOIN platform_listing_skus pls ON pls.sku_id = s.id
        JOIN platform_listings pl ON pl.id = pls.listing_id
        JOIN platforms p ON p.id = pl.platform_id
       WHERE p.code IN ('WB', 'YANDEX')
         AND NOT EXISTS (SELECT 1 FROM sku_images si WHERE si.sku_id = s.id)
       ORDER BY s.sku_code
    `);

    let resolvable = 0;
    let queued = 0;
    for (const row of rows) {
      const url = resolveOnboardImageUrl(row.variant_raw, row.listing_raw);
      const label = `${row.platform} ${row.sku_code}`;
      if (url === null) {
        console.log(`  ${label}: 商品链接里没有可用图片，跳过`);
        continue;
      }
      resolvable += 1;
      if (!apply) {
        console.log(`  ${label}: 将入队 ${url.slice(0, 80)}…`);
        continue;
      }
      const ok = await importService.scheduleFromOnboard(row.id, url);
      if (ok) {
        queued += 1;
        console.log(`  ${label}: 已入队`);
      }
    }

    console.log(
      `\n共 ${rows.length} 个 WB/Yandex SKU 无图；可解析出图片 ${resolvable} 个；` +
        (apply ? `已入队 ${queued} 个。` : 'DRY RUN：未改任何数据，加 --apply 执行。'),
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
