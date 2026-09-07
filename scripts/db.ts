/**
 * Database migration runner (wrapper around TypeORM).
 *
 * Commands:
 *   tsx scripts/db.ts create <Name>     Create an empty migration scaffold
 *   tsx scripts/db.ts generate <Name>   Generate a migration from entity diff (requires DB)
 *   tsx scripts/db.ts run               Run pending migrations
 *   tsx scripts/db.ts revert            Revert the last migration
 *   tsx scripts/db.ts show              Show migration status
 *
 * Migration files follow `YYYYMMDD_NNN_snake_name.ts`
 * (docs: WCIES 工程架构与 Monorepo 目录设计 §57).
 * Run/revert/show use the DataSource API directly; only generate shells out
 * to the TypeORM CLI.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';

const ROOT = resolve(import.meta.dirname, '..');
const MIGRATIONS_DIR = resolve(ROOT, 'database/migrations');
const DATASOURCE_TS = 'apps/api/src/database/datasource.ts';

function pascalToSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

function dateToYmd(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function nextSequence(today: string): number {
  const prefix = `${today}_`;
  const existing = existsSync(MIGRATIONS_DIR)
    ? readdirSync(MIGRATIONS_DIR).filter((file) => file.startsWith(prefix))
    : [];
  return (
    existing.reduce((acc, file) => {
      const match = /^(\d{8})_(\d{3})_/.exec(file);
      return Math.max(acc, match?.[2] ? Number.parseInt(match[2], 10) : 0);
    }, 0) + 1
  );
}

async function withDataSource<T>(fn: (ds: DataSource) => Promise<T>): Promise<T> {
  const { default: dataSource } = await import('../apps/api/src/database/datasource');
  await dataSource.initialize();
  try {
    return await fn(dataSource);
  } finally {
    await dataSource.destroy();
  }
}

async function runMigrations(): Promise<void> {
  await withDataSource(async (ds) => {
    const executed = await ds.runMigrations({ transaction: 'each' });
    for (const migration of executed) {
      console.log(`executed: ${migration.name}`);
    }
    if (executed.length === 0) {
      console.log('No pending migrations.');
    }
  });
}

async function revertMigration(): Promise<void> {
  await withDataSource(async (ds) => {
    await ds.undoLastMigration({ transaction: 'each' });
    console.log('reverted last migration');
  });
}

async function showMigrations(): Promise<void> {
  await withDataSource(async (ds) => {
    const { MigrationExecutor } = await import('typeorm');
    const executor = new MigrationExecutor(ds);
    const executed = await executor.getExecutedMigrations();
    const pending = await executor.getPendingMigrations();
    if (executed.length === 0 && pending.length === 0) {
      console.log('No migrations found.');
      return;
    }
    for (const migration of executed) {
      console.log(`[x] applied  ${migration.name}`);
    }
    for (const migration of pending) {
      console.log(`[ ] pending ${migration.name}`);
    }
  });
}

function createMigration(rawName: string): void {
  const today = dateToYmd();
  const seq = nextSequence(today);
  const fileName = `${today}_${String(seq).padStart(3, '0')}_${pascalToSnake(rawName)}.ts`;
  // TypeORM requires the CLASS name to end with a millisecond timestamp
  // (migration ordering); the FILE name keeps the project convention.
  const className = `${rawName}${Date.now()}`;

  const template = `import { MigrationInterface, QueryRunner } from 'typeorm';

export class ${className} implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // TODO: implement
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // TODO: implement
  }
}
`;
  writeFileSync(resolve(MIGRATIONS_DIR, fileName), template, 'utf8');
  console.log(`Created database/migrations/${fileName}`);
}

function generateMigration(rawName: string): void {
  const before = new Set(readdirSync(MIGRATIONS_DIR));
  // shell:true lets Windows resolve pnpm.cmd; args are fixed constants plus a
  // validated PascalCase name, never free-form shell input.
  const result = spawnSync(
    'pnpm exec tsx node_modules/typeorm/cli.js migration:generate',
    ['-d', DATASOURCE_TS, '-n', rawName, 'database/migrations'],
    { cwd: ROOT, stdio: 'inherit', shell: true },
  );
  if (result.status !== 0) {
    throw new Error('typeorm migration:generate failed');
  }
  // Rename generated <timestamp>_<Name>.ts into the project convention.
  const today = dateToYmd();
  let seq = nextSequence(today);
  for (const file of readdirSync(MIGRATIONS_DIR)) {
    if (before.has(file) || !file.endsWith('.ts')) {
      continue;
    }
    const match = /^\d+_(.+)\.ts$/.exec(file);
    const semantic = match?.[1] ?? file.replace(/\.ts$/, '');
    const target = `${today}_${String(seq).padStart(3, '0')}_${pascalToSnake(semantic)}.ts`;
    renameSync(resolve(MIGRATIONS_DIR, file), resolve(MIGRATIONS_DIR, target));
    console.log(`Renamed ${file} -> ${target}`);
    seq += 1;
  }
}

async function main(): Promise<void> {
  const [command, nameArg] = process.argv.slice(2) as [string | undefined, string | undefined];
  switch (command) {
    case 'create':
      if (nameArg === undefined || nameArg.length === 0) {
        throw new Error('Usage: tsx scripts/db.ts create <PascalCaseName>');
      }
      createMigration(nameArg);
      break;
    case 'generate':
      if (nameArg === undefined || nameArg.length === 0) {
        throw new Error('Usage: tsx scripts/db.ts generate <PascalCaseName>');
      }
      generateMigration(nameArg);
      break;
    case 'run':
      await runMigrations();
      break;
    case 'revert':
      await revertMigration();
      break;
    case 'show':
      await showMigrations();
      break;
    default:
      throw new Error(
        `Unknown command: ${command ?? '(none)'}. Use create|generate|run|revert|show.`,
      );
  }
}

void main();
