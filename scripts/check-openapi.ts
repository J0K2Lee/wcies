/**
 * OpenAPI contract guard (Sprint 5 P0, revision §5/§6).
 *
 * Fails (exit code 1) when the exported openapi.json no longer truthfully
 * describes the response DTO contract:
 *   1. No schema in components.schemas may have empty `properties` (the
 *      regression that made ShipmentEnvelopeDto useless).
 *   2. A curated list of core response DTOs must exist with non-empty
 *      properties.
 *   3. Every path-level 2xx response that declares `schema` must resolve -
 *      no dangling $ref, no fully-undocumented success responses.
 *
 * Run after `pnpm openapi:export` (CI step: `pnpm check:openapi`).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SPEC_PATH = resolve(ROOT, 'openapi.json');

/** Core response DTOs that MUST stay in components.schemas (revision §5). */
const REQUIRED_SCHEMAS = [
  'ShipmentDetailDto',
  'ShipmentListItemDto',
  'OrderDetailDto',
  'OrderListItemDto',
  'StoreResponseDto',
  'ProductDetailDto',
  'SkuResponseDto',
  'ListingDetailDto',
  'ListingResponseDto',
  'ReservationDto',
  'InventoryRowDto',
  'NotificationDto',
  'ExceptionItemDto',
  'PickingTaskDetailDto',
  'ImportJobResponseDto',
];

interface SchemaObject {
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

interface OpenApiDocument {
  components?: { schemas?: Record<string, SchemaObject> };
  paths?: Record<string, Record<string, unknown>>;
}

function main(): void {
  if (!existsSync(SPEC_PATH)) {
    console.error(`openapi.json not found at ${SPEC_PATH}. Run \`pnpm openapi:export\` first.`);
    process.exit(1);
  }
  const doc = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApiDocument;
  const schemas = doc.components?.schemas ?? {};
  const errors: string[] = [];

  // 1. No empty-properties schemas (undecorated DTO classes).
  for (const [name, schema] of Object.entries(schemas)) {
    if (
      typeof schema === 'object' &&
      schema !== null &&
      !('$ref' in schema) &&
      Object.keys(schema).length > 0 &&
      'properties' in schema &&
      schema.properties !== undefined &&
      Object.keys(schema.properties).length === 0
    ) {
      errors.push(`schema "${name}" has empty properties (undecorated DTO class?)`);
    }
  }

  // 2. Required core DTOs present and non-empty.
  for (const name of REQUIRED_SCHEMAS) {
    const schema = schemas[name];
    if (schema === undefined) {
      errors.push(`required schema "${name}" is missing from components.schemas`);
    } else if (Object.keys(schema.properties ?? {}).length === 0) {
      errors.push(`required schema "${name}" exists but has no properties`);
    }
  }

  // 3. Success responses must be documented and resolve.
  //    A response is documented when it declares JSON content with a schema,
  //    OR explicitly non-JSON content (e.g. a binary file download declared
  //    with its media type). A bare `{ description }` response still fails.
  let documentedResponses = 0;
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      if (typeof op !== 'object' || op === null) {
        continue;
      }
      const responses = (op as { responses?: Record<string, { content?: unknown }> }).responses;
      const okResponse = responses?.['200'] ?? responses?.['201'];
      if (okResponse === undefined) {
        continue;
      }
      const content = okResponse.content as Record<string, { schema?: unknown }> | undefined;
      if (content === undefined || Object.keys(content).length === 0) {
        errors.push(`${method.toUpperCase()} ${path}: 2xx response declares no content at all`);
        continue;
      }
      const json = content['application/json'];
      if (json === undefined) {
        // Non-JSON content (binary download) is documented by its media type.
        documentedResponses += 1;
        continue;
      }
      const schema = json.schema;
      if (schema === undefined) {
        errors.push(`${method.toUpperCase()} ${path}: 2xx response has no JSON schema`);
        continue;
      }
      documentedResponses += 1;
      const refs = collectRefs(schema);
      for (const ref of refs) {
        const name = ref.replace('#/components/schemas/', '');
        if (schemas[name] === undefined) {
          errors.push(`${method.toUpperCase()} ${path}: dangling $ref "${ref}"`);
        }
      }
    }
  }
  if (documentedResponses === 0) {
    errors.push('no documented 2xx JSON responses found at all');
  }

  if (errors.length > 0) {
    console.error(`OpenAPI schema check FAILED with ${errors.length} error(s):\n`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }
  console.log(
    `OpenAPI schema check passed (${Object.keys(schemas).length} schemas, ` +
      `${documentedResponses} documented 2xx responses, ${REQUIRED_SCHEMAS.length} required DTOs verified).`,
  );
}

function collectRefs(node: unknown, seen = new Set<string>()): string[] {
  if (typeof node !== 'object' || node === null) {
    return [];
  }
  const refs: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') {
      refs.push(value);
    } else if (typeof value === 'object' && value !== null && !seen.has(String(key))) {
      refs.push(...collectRefs(value));
    }
  }
  return refs;
}

main();
