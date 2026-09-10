/**
 * Exports the OpenAPI document (openapi.json) from the compiled API app.
 *
 * Prerequisites:
 *   - `pnpm --filter @wcies/api build` (uses dist/, because the Nest app
 *     requires fully compiled decorator metadata)
 *   - docker compose services running (module init connects to them)
 *
 * Usage: pnpm openapi:export   (writes ./openapi.json at the repo root)
 */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

config({ path: ['../../.env', '.env'] });

const ROOT = resolve(__dirname, '../../..');

async function main(): Promise<void> {
  const { AppModule } = await import('../dist/app.module.js');
  // Full HTTP app (Swagger scanning needs the http adapter); we never listen.
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('WCIES API')
      .setDescription('WCIES cross-border e-commerce management system API')
      .setVersion('0.1.0')
      .addCookieAuth('wcies_session')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    // Document paths must match real URLs: ensure the /api/v1 global prefix
    // on everything except /health* (excluded from the prefix at runtime).
    // The prefix is added only when missing so this never doubles it.
    const apiPrefix = '/api/v1';
    const originalPaths = document.paths as unknown as Record<string, object>;
    const rewritten: Record<string, object> = {};
    for (const [path, item] of Object.entries(originalPaths)) {
      rewritten[
        path.startsWith('/health') || path.startsWith(apiPrefix) ? path : `${apiPrefix}${path}`
      ] = item;
    }
    (document as { paths: Record<string, object> }).paths = rewritten;
    const target = resolve(ROOT, 'openapi.json');
    writeFileSync(target, JSON.stringify(document, null, 2), 'utf8');
    console.log(`OpenAPI document written to ${target}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('openapi:export failed:', error instanceof Error ? error.stack : error);
  process.exit(1);
});
