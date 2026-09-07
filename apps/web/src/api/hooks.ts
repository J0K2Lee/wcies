import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { WciesPaths } from '@wcies/api-client';

type QueryKey = keyof WciesPaths & string;

/**
 * Typed GET helper for the generated api-client: unwraps the envelope and
 * throws the unified error message on failure (pages only handle data).
 */
export function useApiQuery<
  TData,
  TQuery extends Record<string, unknown> = Record<string, unknown>,
>(path: QueryKey, params: TQuery, queryKey: unknown[]): UseQueryResult<TData> {
  return useQuery<TData>({
    queryKey,
    queryFn: async () => {
      const { data, error } = await apiClient.GET(path, {
        params: { query: params as never },
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

/** Typed DELETE helper. */
export async function apiDelete(path: QueryKey, pathParams: Record<string, string>): Promise<void> {
  const { error } = await apiClient.DELETE(path, { params: { path: pathParams as never } });
  if (error !== undefined) {
    throw new Error(error.error.message);
  }
}
