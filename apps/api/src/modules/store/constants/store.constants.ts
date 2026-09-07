export const STORE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

export const CREDENTIAL_TYPES = ['MAIN_API'] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export const CREDENTIAL_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];
