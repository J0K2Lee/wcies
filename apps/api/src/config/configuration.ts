import { registerAs } from '@nestjs/config';

export type NodeEnv = 'development' | 'test' | 'production';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
}

export interface S3Config {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  forcePathStyle: boolean;
}

/**
 * Typed application configuration, exposed via `ConfigService.get('app', { infer: true })`.
 * Shape is guaranteed by the Joi schema in env.validation.ts.
 */
export const appConfig = registerAs('app', () => {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as NodeEnv;
  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: Number.parseInt(process.env.PORT ?? '3000', 10),
    corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    databaseUrl: process.env.DATABASE_URL ?? '',
    redisUrl: process.env.REDIS_URL ?? '',
    jwtSecret: process.env.JWT_SECRET ?? '',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    credentialEncryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY ?? '',
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      accessKey: process.env.S3_ACCESS_KEY ?? '',
      secretKey: process.env.S3_SECRET_KEY ?? '',
      bucket: process.env.S3_BUCKET ?? '',
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    } satisfies S3Config,
    /**
     * Feishu webhook for outbound notifications (Sprint 4 task §49): purely
     * OPTIONAL - when absent the FEISHU channel stays a Provider boundary and
     * only SYSTEM notifications are created. No default URL is ever guessed.
     */
    feishuWebhookUrl: process.env.FEISHU_WEBHOOK_URL ?? null,
    /**
     * Public base URL for INBOUND platform callbacks (OZON webhooks, see
     * docs/integrations/ozon-webhook-tunnel.md). Null when unset - callers
     * must NOT fall back to localhost, that URL is unreachable from OZON.
     */
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? null,
    /**
     * Fallback re-read rotation window (dual-axis T2): an order re-enters
     * the ORDER_SYNC candidate set only after this many hours since its last
     * CONFIRMED platform-facts check. Webhooks deliver changes within
     * minutes; this rotation is the safety net when they are paused
     * (docs/integrations/ozon.md §6.5 auto-pause is a real risk). Fractional
     * hours are allowed so integration tests can exercise the rotation.
     */
    orderStateFallbackHours: Number.parseFloat(process.env.ORDER_STATE_FALLBACK_HOURS ?? '24'),
    /**
     * Transactional email (user management verification mail, Feishu SMTP).
     * All fields OPTIONAL at boot: when host/user/password are not fully
     * configured the email features fail with EMAIL_NOT_CONFIGURED instead
     * of guessing a server (AGENTS.md §29 spirit - no secrets in code).
     * Port 465 = implicit TLS; 587 = STARTTLS.
     */
    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: Number.parseInt(process.env.SMTP_PORT ?? '465', 10),
      secure: Number.parseInt(process.env.SMTP_PORT ?? '465', 10) === 465,
      user: process.env.SMTP_USER ?? '',
      password: process.env.SMTP_PASSWORD ?? '',
      fromName: process.env.SMTP_FROM_NAME ?? 'WCIES',
    } satisfies SmtpConfig,
    /**
     * Browser-facing base URL used to build links inside verification emails
     * (e.g. {webBaseUrl}/invite?token=...). Defaults to the Vite dev server.
     */
    webBaseUrl: process.env.WEB_BASE_URL ?? 'http://localhost:5173',
  };
});

export type AppConfig = ReturnType<typeof appConfig>;
