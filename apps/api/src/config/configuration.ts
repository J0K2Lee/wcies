import { registerAs } from '@nestjs/config';

export type NodeEnv = 'development' | 'test' | 'production';

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
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
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
  };
});

export type AppConfig = ReturnType<typeof appConfig>;
