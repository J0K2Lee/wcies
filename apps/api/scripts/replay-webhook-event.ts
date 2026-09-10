/**
 * Dev-only webhook replay (Sprint 6 T7 §13.2).
 *
 * Answers the manual-test question "webhook 是否未实现？本地无公网 IP 如何测试?":
 * the webhook entry IS implemented (POST /api/v1/webhooks/ozon/stores/:storeCode,
 * a public route). Local testing needs NO public IP - either POST to the local
 * API directly (curl), or replay an already-stored raw event via this script.
 *
 * What it does:
 *   1. refuses to run when NODE_ENV=production (AGENTS.md §93);
 *   2. picks an external_raw_events row (--id <uuid>, or the most recent);
 *   3. optionally resets it to PENDING (--reset) so the processor accepts it;
 *   4. re-enqueues { rawEventId } onto the wcies.webhook BullMQ queue.
 *
 * Verify afterwards:
 *   - raw event traceability: the external_raw_events row changes status;
 *   - queueing: the worker logs a wcies.webhook job;
 *   - idempotency: replaying twice never creates a duplicate order
 *     (ingestion is keyed by store_id + platform_order_id).
 *
 * Usage (repo root):
 *   npx tsx apps/api/scripts/replay-webhook-event.ts [--id <uuid>] [--reset]
 */
import { config } from 'dotenv';
import { Client } from 'pg';

config({ path: ['.env', 'apps/api/.env'], quiet: true });

interface RawEventRow {
  id: string;
  platform: string;
  event_type: string | null;
  status: string;
  received_at: Date;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to run in production (AGENTS.md §93)');
  }
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (databaseUrl === undefined || redisUrl === undefined) {
    throw new Error('DATABASE_URL / REDIS_URL must be set (see .env)');
  }

  const args = process.argv.slice(2);
  const idIndex = args.indexOf('--id');
  const explicitId = idIndex >= 0 ? (args[idIndex + 1] ?? null) : null;
  const reset = args.includes('--reset');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let event: RawEventRow | undefined;
  try {
    event = explicitId
      ? (
          await client.query<RawEventRow>(
            'SELECT id, platform, event_type, status, received_at FROM external_raw_events WHERE id = $1',
            [explicitId],
          )
        ).rows[0]
      : (
          await client.query<RawEventRow>(
            'SELECT id, platform, event_type, status, received_at FROM external_raw_events ORDER BY received_at DESC LIMIT 1',
          )
        ).rows[0];

    if (event === undefined) {
      console.log('No matching external_raw_events row. POST a webhook first, e.g.:');
      console.log('  curl -X POST http://localhost:3000/api/v1/webhooks/ozon/stores/<storeCode> \\');
      console.log('       -H "Content-Type: application/json" -d \'{"message_type":"ping"}\'');
      return;
    }

    console.log(
      `Replaying raw event ${event.id} (${event.platform}/${event.event_type ?? '?'}, status=${event.status}, received ${event.received_at.toISOString()})`,
    );

    if (reset) {
      await client.query('UPDATE external_raw_events SET status = $2 WHERE id = $1', [
        event.id,
        'PENDING',
      ]);
      console.log('Status reset to PENDING (processor only accepts PENDING rows).');
    } else if (event.status !== 'PENDING') {
      console.log(
        `Note: status is ${event.status}; the processor will SKIP it unless you pass --reset.`,
      );
    }
  } finally {
    await client.end();
  }

  // Enqueue through BullMQ with the same payload the HTTP entry uses.
  const { Queue } = await import('bullmq');
  const IORedis = (await import('ioredis')).default;
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue('wcies.webhook', { connection });
  await queue.add('webhook', { rawEventId: event.id });
  console.log(`Enqueued wcies.webhook job for rawEventId=${event.id}`);
  await queue.close();
  connection.disconnect();
}

main().catch((error: unknown) => {
  console.error('replay-webhook-event failed:', error instanceof Error ? error.stack : error);
  process.exit(1);
});
