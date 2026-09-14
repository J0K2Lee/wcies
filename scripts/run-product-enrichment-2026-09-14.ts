/**
 * One-off ops script (user request 2026-09-14): re-run PRODUCT_ENRICHMENT_SYNC
 * for the dev store after the test-database reset. The reset intentionally
 * wiped platform_listing_skus; the re-run LISTING_SYNC recreated the variant
 * rows WITHOUT the v4 packed attributes (weight/dimensions), so the onboarding
 * modal's prefill was empty. The enrichment sync merges
 * /v4/product/info/attributes back into variant raw_data.
 *
 * Boots a standalone Nest application context from the COMPILED AppModule
 * (apps/api/dist - same graph as main.js; booting TS sources via tsx hits
 * decorator/DI-metadata resolution differences), dispatches the sync through
 * the normal SyncDispatchService (SyncJob row + BullMQ, full §44/§45
 * bookkeeping) and waits for the job to finish.
 *
 * Safety: refuses NODE_ENV=production; refuses non-wcies_dev DATABASE_URL.
 *
 * Usage: pnpm --filter @wcies/api build && tsx scripts/run-product-enrichment-2026-09-14.ts
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import 'dotenv/config';
import { createRequire } from 'node:module';
import { NestFactory } from '@nestjs/core';

const requireDist = createRequire(__filename);

function fail(reason: string): never {
  console.error(`[enrichment] ABORT: ${reason}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    fail('NODE_ENV=production - dev ops script only.');
  }
  const url = process.env.DATABASE_URL ?? '';
  if (!url.includes('wcies_dev')) {
    fail(`DATABASE_URL does not point at wcies_dev: ${url}`);
  }

  const { AppModule } = requireDist('../apps/api/dist/app.module.js');
  const { StoreService } = requireDist('../apps/api/dist/modules/store/services/store.service.js');
  const { SyncDispatchService } = requireDist(
    '../apps/api/dist/modules/sync/services/sync-dispatch.service.js',
  );
  const { SyncJobRepository } = requireDist(
    '../apps/api/dist/modules/sync/repositories/sync-job.repository.js',
  );

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const storeService: {
      listAllActive(): Promise<Array<{ id: string; storeCode: string; name: string }>>;
    } = app.get(StoreService);
    const stores = await storeService.listAllActive();
    if (stores.length !== 1) {
      fail(`expected exactly 1 ACTIVE store, found ${stores.length}`);
    }
    const store = stores[0]!;
    console.log(`[enrichment] store ${store.storeCode} (${store.name})`);

    const dispatch: {
      dispatch(input: {
        storeId: string;
        syncType: string;
        trigger: string;
      }): Promise<{ id: string }>;
    } = app.get(SyncDispatchService);
    const job = await dispatch.dispatch({
      storeId: store.id,
      syncType: 'PRODUCT_ENRICHMENT_SYNC',
      trigger: 'MANUAL',
    });
    console.log(`[enrichment] dispatched sync job ${job.id}`);

    const jobRepo: {
      findById(id: string): Promise<{
        status: string;
        successCount: number;
        failedCount: number;
        skippedCount: number;
        errorCode: string | null;
        errorMessage: string | null;
      } | null>;
    } = app.get(SyncJobRepository);
    const deadline = Date.now() + 10 * 60 * 1000;
    for (;;) {
      const current = await jobRepo.findById(job.id);
      if (current === null) {
        fail('sync job row disappeared');
      }
      if (['SUCCESS', 'PARTIAL', 'FAILED'].includes(current.status)) {
        console.log(
          `[enrichment] finished status=${current.status} success=${current.successCount} ` +
            `failed=${current.failedCount} skipped=${current.skippedCount} ` +
            `error=${current.errorCode ?? 'none'}`,
        );
        if (current.status === 'FAILED') {
          fail(current.errorMessage ?? 'enrichment sync failed');
        }
        break;
      }
      if (Date.now() > deadline) {
        fail('timed out after 10 minutes');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    console.log('[enrichment] OK - onboarding modal prefill is available again.');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('[enrichment] failed:', error);
  process.exit(1);
});
