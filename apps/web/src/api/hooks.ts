import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { WciesPaths } from '@wcies/api-client';

type QueryKey = keyof WciesPaths & string;

/**
 * API error carrying the backend's machine-readable code and details so pages
 * can distinguish auth expiry / IN_USE guards / validation failures instead
 * of string-matching messages (decision 0004).
 */
export class ApiError extends Error {
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'AUTH_UNAUTHORIZED';
}

/**
 * Validation failures put the field-level reasons in
 * `details.validationErrors` while the envelope message stays the constant
 * "Request validation failed". Appending them keeps the error actionable
 * (which field, which rule) instead of opaque.
 */
function describeValidationErrors(
  message: string,
  code: string | undefined,
  details: unknown,
): string {
  if (code !== 'COMMON_VALIDATION_FAILED' || typeof details !== 'object' || details === null) {
    return message;
  }
  const errors = (details as { validationErrors?: unknown }).validationErrors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return message;
  }
  return `${message}: ${errors.map(String).join('；')}`;
}

/** Builds the page-facing error from the envelope's `error` object. */
function toApiError(body: { message: string; code?: string; details?: unknown }): ApiError {
  return new ApiError(
    describeValidationErrors(body.message, body.code, body.details),
    body.code,
    body.details,
  );
}

/** Debounces a fast-changing value (e.g. Select onSearch) for server-side filtering. */
export function useDebouncedValue<TValue>(value: TValue, delayMs = 300): TValue {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Typed GET helper for the generated api-client: unwraps the envelope and
 * throws the unified error message on failure (pages only handle data).
 * `pathParams` substitutes `{placeholders}` in templated paths; `enabled`
 * gates the query (e.g. until a drawer opens).
 */
export function useApiQuery<
  TData,
  TQuery extends Record<string, unknown> = Record<string, unknown>,
>(
  path: QueryKey,
  params: TQuery,
  queryKey: unknown[],
  pathParams?: Record<string, string>,
  enabled = true,
): UseQueryResult<TData> {
  return useQuery<TData>({
    queryKey,
    enabled,
    queryFn: async () => {
      const { data, error } = await apiClient.GET(path, {
        params: {
          query: params as never,
          ...(pathParams === undefined ? {} : { path: pathParams as never }),
        },
      });
      if (error !== undefined) {
        throw toApiError(error.error);
      }
      // Normalize the { success, data, meta? } envelope into { data, meta }
      // so paginated and plain lists share one page-side shape.
      const envelope = data as { data: TData; meta?: { total: number } };
      return {
        data: envelope.data,
        meta: envelope.meta ?? { total: Array.isArray(envelope.data) ? envelope.data.length : 0 },
      } as TData;
    },
  });
}

/** Typed GET helper returning the unwrapped data or throwing (one-off fetches
 *  outside React queries, e.g. deep-link handlers). */
export async function apiGet<TData>(
  path: QueryKey,
  params: Record<string, unknown> = {},
  pathParams?: Record<string, string>,
): Promise<TData> {
  const { data, error } = await apiClient.GET(path, {
    params: {
      query: params as never,
      ...(pathParams === undefined ? {} : { path: pathParams as never }),
    },
  });
  if (error !== undefined) {
    throw toApiError(error.error);
  }
  return (data as { data: TData }).data;
}

/** Typed POST helper returning the unwrapped data or throwing. */
export async function apiPost<TData>(
  path: QueryKey,
  body: unknown,
  pathParams?: Record<string, string>,
): Promise<TData> {
  const { data, error } = await apiClient.POST(path, {
    params: pathParams === undefined ? undefined : { path: pathParams as never },
    body: body as never,
  });
  if (error !== undefined) {
    throw toApiError(error.error);
  }
  return (data as { data: TData }).data;
}

/** Typed PATCH helper returning the unwrapped data or throwing. */
export async function apiPatch<TData>(
  path: QueryKey,
  body: unknown,
  pathParams?: Record<string, string>,
): Promise<TData> {
  const { data, error } = await apiClient.PATCH(path, {
    params: pathParams === undefined ? undefined : { path: pathParams as never },
    body: body as never,
  });
  if (error !== undefined) {
    throw toApiError(error.error);
  }
  return (data as { data: TData }).data;
}

/** Typed PUT helper returning the unwrapped data or throwing. */
export async function apiPut<TData>(
  path: QueryKey,
  body: unknown,
  pathParams?: Record<string, string>,
): Promise<TData> {
  const { data, error } = await apiClient.PUT(path, {
    params: pathParams === undefined ? undefined : { path: pathParams as never },
    body: body as never,
  });
  if (error !== undefined) {
    throw toApiError(error.error);
  }
  return (data as { data: TData }).data;
}

/** Typed DELETE helper. */
export async function apiDelete(path: QueryKey, pathParams: Record<string, string>): Promise<void> {
  const { error } = await apiClient.DELETE(path, { params: { path: pathParams as never } });
  if (error !== undefined) {
    throw toApiError(error.error);
  }
}
