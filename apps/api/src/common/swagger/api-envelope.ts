import { Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

/**
 * Swagger envelope helpers for the unified `{ success, data, meta }` response
 * format (Sprint 0 task §11; Sprint 5 P0 fix).
 *
 * Hand-written envelope classes produced empty `properties: {}` schemas
 * because their fields carried no `@ApiProperty`, so referenced business DTOs
 * never reached `components.schemas` and the generated api-client had no real
 * response types. These decorators register the business DTO via
 * `@ApiExtraModels` and reference it with `$ref`, keeping the wire format and
 * the `ok()` / `okPage()` runtime helpers untouched.
 */

/** `{ success: true, data: T }` success envelope. */
export function ApiOkEnvelope<TData>(dto: Type<TData>) {
  return applyDecorators(
    ApiExtraModels(dto),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { $ref: getSchemaPath(dto) },
        },
      },
    }),
  );
}

/** `{ success: true, data: T[] }` array envelope (unpaged lists). */
export function ApiOkArrayEnvelope<TItem>(dto: Type<TItem>) {
  return applyDecorators(
    ApiExtraModels(dto),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { type: 'array', items: { $ref: getSchemaPath(dto) } },
        },
      },
    }),
  );
}

/** `{ success: true, data: T | null }` success envelope (nullable resource). */
export function ApiOkNullableEnvelope<TData>(dto: Type<TData>) {
  return applyDecorators(
    ApiExtraModels(dto),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { nullable: true, allOf: [{ $ref: getSchemaPath(dto) }] },
        },
      },
    }),
  );
}

/** `{ success: true, data: {} }` envelope for acknowledged actions. */
export function ApiOkNoDataEnvelope() {
  return ApiOkResponse({
    schema: {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: { type: 'object' },
      },
    },
  });
}

/** `{ success: true, data: T[], meta }` paged envelope. */
export function ApiOkPagedEnvelope<TItem>(dto: Type<TItem>) {
  return applyDecorators(
    ApiExtraModels(dto),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['success', 'data', 'meta'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { type: 'array', items: { $ref: getSchemaPath(dto) } },
          meta: {
            type: 'object',
            required: ['page', 'pageSize', 'total'],
            properties: {
              page: { type: 'integer', minimum: 1 },
              pageSize: { type: 'integer', minimum: 1 },
              total: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    }),
  );
}
