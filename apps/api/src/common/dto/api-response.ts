import { PageMeta } from '@wcies/shared';

/**
 * Unified response envelope helpers (Sprint 0 task §11).
 *
 * Controllers return `ok(data)` / `okPage(items, meta)` so the response type
 * shown in Swagger matches the wire format exactly, which keeps the generated
 * api-client types truthful.
 *
 * Error responses are produced exclusively by the GlobalExceptionFilter.
 */
export function ok<TData>(data: TData): { success: true; data: TData } {
  return { success: true, data };
}

export function okPage<TItem>(
  data: TItem[],
  meta: PageMeta,
): { success: true; data: TItem[]; meta: PageMeta } {
  return { success: true, data, meta };
}
