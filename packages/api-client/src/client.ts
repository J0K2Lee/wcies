import createOpenApiClient from 'openapi-fetch';
import { paths } from './generated/schema';

export type WciesPaths = paths;

export interface WciesClientOptions {
  /** Base URL of the WCIES API. Empty string means same-origin (dev proxy). */
  baseUrl?: string;
  /** Custom fetch implementation (tests). */
  fetch?: typeof fetch;
}

/**
 * Create the typed WCIES API client.
 *
 * This is the single sanctioned way for the web app to call the API -
 * never hand-write `fetch('/api/v1/...')` calls (AGENTS.md §72).
 */
export function createWciesClient(options: WciesClientOptions = {}) {
  return createOpenApiClient<paths>({
    baseUrl: options.baseUrl ?? '',
    fetch: options.fetch,
    credentials: 'include',
  });
}
