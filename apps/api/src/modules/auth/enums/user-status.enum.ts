export const USER_STATUSES = ['ACTIVE', 'PENDING_VERIFICATION', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS_ACTIVE: UserStatus = 'ACTIVE';
export const USER_STATUS_DISABLED: UserStatus = 'DISABLED';
/**
 * Admin-created account whose mailbox has not been proven yet: the invite
 * email must be confirmed (and an initial password set) before login works.
 * Added 2026-10-05 with the user management system (docs/business-rules/users.md).
 */
export const USER_STATUS_PENDING_VERIFICATION: UserStatus = 'PENDING_VERIFICATION';
