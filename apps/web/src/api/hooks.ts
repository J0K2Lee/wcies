import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { WciesPaths } from '@wcies/api-client';

type QueryKey = keyof WciesPaths & string;

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
        throw new Error(error.error.message);
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
    throw new Error(error.error.message);
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
    throw new Error(error.error.message);
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
    throw new Error(error.error.message);
  }
  return (data as { data: TData }).data;
}

/** Typed DELETE helper. */
export async function apiDelete(path: QueryKey, pathParams: Record<string, string>): Promise<void> {
  const { error } = await apiClient.DELETE(path, { params: { path: pathParams as never } });
  if (error !== undefined) {
    throw new Error(error.error.message);
  }
}
