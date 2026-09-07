import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request / per-job async context (requestId etc.), propagated without
 * manual threading through call stacks (Sprint 0 task §26).
 */
export interface RequestContext {
  requestId: string;
  userId?: string;
  storeId?: string;
  platform?: string;
  jobId?: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function getRequestId(): string {
  return requestContextStorage.getStore()?.requestId ?? 'no-request-id';
}
