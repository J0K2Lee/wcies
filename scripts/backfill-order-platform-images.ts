/**
 * Dev-only platform image backfill. Default dry-run still reads the real adapter.
 * Build API first. --apply requires --backup-confirmed after an actual backup.
 * Creates the HTTP DI container WITHOUT init/listen: no queue workers or hooks.
 * Dry-run connections are PostgreSQL read-only as an additional safety barrier.
 */
import { config } from 'dotenv';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { OrderSyncService } from '../apps/api/src/modules/sync/services/order-sync.service';
import { StoreService } from '../apps/api/src/modules/store/services/store.service';

const root = resolve(import.meta.dirname, '..');
config({ path: resolve(root, '.env'), quiet: true });
const requireApi = createRequire(resolve(root, 'apps/api/package.json'));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--apply', '--backup-confirmed'].includes(arg))) {
    throw new Error('Unsupported argument');
  }
  if (!['development', 'test'].includes(process.env.NODE_ENV ?? '')) {
    throw new Error('Explicit development/test NODE_ENV required');
  }
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.pathname !== '/wcies_dev' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error('Only local wcies_dev is allowed');
  }
  const apply = args.includes('--apply');
  if (apply && !args.includes('--backup-confirmed')) throw new Error('Back up before --apply');
  if (!apply) {
    url.searchParams.set('options', '-c default_transaction_read_only=on');
    process.env.DATABASE_URL = url.toString();
  }
  interface Container {
    get<T>(token: unknown): T;
    close(): Promise<void>;
  }
  const { NestFactory } = requireApi('@nestjs/core') as {
    NestFactory: {
      create(
        module: unknown,
        options: { logger: false; abortOnError: false },
      ): Promise<Container & { init(): Promise<Container> }>;
    };
  };
  const { AppModule } = requireApi('./dist/app.module.js') as { AppModule: unknown };
  const { OrderSyncService: SyncToken } = requireApi(
    './dist/modules/sync/services/order-sync.service.js',
  ) as {
    OrderSyncService: new (...args: never[]) => OrderSyncService;
  };
  const { StoreService: StoreToken } = requireApi(
    './dist/modules/store/services/store.service.js',
  ) as {
    StoreService: new (...args: never[]) => StoreService;
  };
  let app: Container | undefined;
  try {
    // init() runs lifecycle hooks (adapter registration) but never starts
    // queue workers: those live in the separate worker.ts entry process.
    // createApplicationContext would work too; the HTTP container is kept so
    // the same providers as the running API are exercised.
    const created = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    app = await created.init();
    const stores = await app.get<StoreService>(StoreToken).listAllActive();
    const sync = app.get<OrderSyncService>(SyncToken);
    let failed = false;
    for (const store of stores) {
      const result = await sync.enrichPlatformImages(store.id, undefined, !apply);
      console.log(
        JSON.stringify({
          script: 'backfill-order-platform-images',
          mode: apply ? 'APPLY' : 'DRY_RUN',
          storeId: store.id,
          ...result,
        }),
      );
      failed ||= result.failed;
    }
    if (failed) process.exitCode = 1;
  } finally {
    await app?.close();
  }
}

void main().catch(() => {
  // Never expose connection strings, credentials, URLs or raw driver errors.
  console.error(
    'Platform image backfill failed. Check dev environment, build, migration and backup confirmation.',
  );
  process.exitCode = 1;
});
