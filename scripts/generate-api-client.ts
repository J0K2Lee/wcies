/**
 * Regenerates packages/api-client/src/generated/schema.d.ts from openapi.json
 * using openapi-typescript.
 *
 * Usage:
 *   pnpm openapi:export        (requires built API + running docker services)
 *   pnpm api-client:generate   (this script; rebuilds @wcies/api-client)
 *
 * The generated file is committed so CI never needs a live API.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';

const ROOT = resolve(import.meta.dirname, '..');
const SPEC = resolve(ROOT, 'openapi.json');
const OUT = resolve(ROOT, 'packages/api-client/src/generated/schema.d.ts');

async function main(): Promise<void> {
  const spec = JSON.parse(readFileSync(SPEC, 'utf8')) as Record<string, unknown>;
  const ast = await openapiTS(spec);
  const header = `/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Regenerate with: pnpm openapi:export && pnpm api-client:generate
 */
`;
  mkdirSync(resolve(OUT, '..'), { recursive: true });
  writeFileSync(OUT, header + astToString(ast), 'utf8');
  console.log(`Generated ${OUT}`);
}

main().catch((error: unknown) => {
  console.error('api-client:generate failed:', error instanceof Error ? error.stack : error);
  process.exit(1);
});
