import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';

// The CLI/migration process runs from the monorepo root; load the root .env
// (no effect when variables are already present in the environment).
config({ path: ['.env', 'apps/api/.env'] });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set - copy .env.example to .env first.');
}

/**
 * CLI-facing DataSource for TypeORM migration commands
 * (create / generate / run / revert / show), executed via `scripts/db.ts`.
 *
 * Schema is only ever managed through migrations:
 * `synchronize` stays false in every environment (AGENTS.md §55).
 *
 * Entities intentionally point at the COMPILED output (apps/api/dist):
 * this file runs under tsx/esbuild, which cannot emit decorator metadata,
 * while migration:generate diffing requires fully decorated entity classes.
 * Run `pnpm --filter @wcies/api build` before `db:migration:generate`.
 * Plain run/revert/show never load entities, so dist is optional there.
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  synchronize: false,
  logging: false,
  // TypeORM 0.3 quirk: uuidExtension 'pgcrypto' selects the PG13+ native
  // gen_random_uuid() generator (the default would emit uuid_generate_v4(),
  // which requires the uuid-ossp extension).
  uuidExtension: 'pgcrypto',
  entities: ['apps/api/dist/modules/**/*.entity.js'],
  migrations: ['database/migrations/*.ts'],
});
