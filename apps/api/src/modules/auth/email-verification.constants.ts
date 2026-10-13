/**
 * Email verification flows and their tokens (docs/business-rules/users.md).
 * Purposes are typed constants, never inline strings (AGENTS.md §64).
 */
export const EMAIL_VERIFICATION_PURPOSES = ['INVITE', 'PASSWORD_CHANGE', 'EMAIL_CHANGE'] as const;
export type EmailVerificationPurpose = (typeof EMAIL_VERIFICATION_PURPOSES)[number];

export const EMAIL_PURPOSE_INVITE: EmailVerificationPurpose = 'INVITE';
export const EMAIL_PURPOSE_PASSWORD_CHANGE: EmailVerificationPurpose = 'PASSWORD_CHANGE';
export const EMAIL_PURPOSE_EMAIL_CHANGE: EmailVerificationPurpose = 'EMAIL_CHANGE';

/** Raw token entropy: 32 random bytes, hex-encoded in links (64 chars). */
export const EMAIL_TOKEN_BYTES = 32;

/** Token TTL by purpose: invites live longer, sensitive changes expire fast. */
export const EMAIL_TOKEN_TTL_MS: Record<EmailVerificationPurpose, number> = {
  [EMAIL_PURPOSE_INVITE]: 48 * 3_600_000,
  [EMAIL_PURPOSE_PASSWORD_CHANGE]: 30 * 60_000,
  [EMAIL_PURPOSE_EMAIL_CHANGE]: 60 * 60_000,
};

/**
 * Minimum delay between two send requests of the same purpose for the same
 * user (Redis cooldown). Feishu allows 200 mails / 100s, so per-user pacing
 * is about abuse, not provider limits.
 */
export const EMAIL_SEND_COOLDOWN_SECONDS = 60;
