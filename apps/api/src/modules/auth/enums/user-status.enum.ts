export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS_ACTIVE: UserStatus = 'ACTIVE';
