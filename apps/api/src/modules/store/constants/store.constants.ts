export const STORE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

/**
 * MAIN_API = seller-API key; WEBHOOK = platform webhook secret (WB 2026-09-18:
 * the webhook secret returned once at subscription creation, used to verify
 * inbound deliveries). AGENTS.md §28 anticipated per-purpose credentials.
 */
export const CREDENTIAL_TYPES = ['MAIN_API', 'WEBHOOK'] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export const CREDENTIAL_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];
