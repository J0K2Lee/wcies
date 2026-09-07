/**
 * Development admin seeder.
 *
 * Reads ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD from the environment
 * (root .env) and upserts the admin user with an Argon2 hash.
 *
 * Real passwords never go into git (Sprint 0 task §32). Refuses to run
 * outside development (AGENTS.md §93).
 */
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import * as argon2 from 'argon2';
import { Client } from 'pg';

config({ path: ['../../.env', '.env'] });

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-dev-data must never run against production.');
  }
  const username = process.env.ADMIN_USERNAME;
  const email = process.env.ADMIN_EMAIL ?? null;
  const password = process.env.ADMIN_PASSWORD;
  if (
    username === undefined ||
    username.length === 0 ||
    password === undefined ||
    password.length < 8
  ) {
    throw new Error(
      'ADMIN_USERNAME and ADMIN_PASSWORD (min 8 chars) must be set in .env before seeding.',
    );
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is not set.');
  }

  const passwordHash = await argon2.hash(password);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE username = $1',
      [username],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row === undefined) {
        throw new Error('unexpected empty row');
      }
      await client.query(
        'UPDATE users SET password_hash = $1, email = $2, status = $3, role = $4 WHERE id = $5',
        [passwordHash, email, 'ACTIVE', 'ADMIN', row.id],
      );
      console.log(`Updated existing admin "${username}" (${row.id}).`);
    } else {
      const id = randomUUID();
      await client.query(
        'INSERT INTO users (id, username, email, password_hash, status, role) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, username, email, passwordHash, 'ACTIVE', 'ADMIN'],
      );
      console.log(`Created admin "${username}" (${id}).`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('seed-dev-data failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
