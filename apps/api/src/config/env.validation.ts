import * as Joi from 'joi';

/**
 * Startup ENV validation. Missing or malformed required values must fail
 * the application boot (Sprint 0 task §20).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  CORS_ORIGIN: Joi.string().default('http://localhost:5173'),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),

  CREDENTIAL_ENCRYPTION_KEY: Joi.string().hex().length(64).required(),

  S3_ENDPOINT: Joi.string().uri().required(),
  S3_ACCESS_KEY: Joi.string().required(),
  S3_SECRET_KEY: Joi.string().required(),
  S3_BUCKET: Joi.string().required(),
  S3_FORCE_PATH_STYLE: Joi.boolean().truthy('true').falsy('false').default(true),

  // Admin seed values are optional at boot; `pnpm seed:dev` enforces them.
  // email(): internal accounts may use non-IANA TLDs (e.g. `.local`).
  ADMIN_USERNAME: Joi.string().optional(),
  ADMIN_EMAIL: Joi.string()
    .email({ tlds: { allow: false } })
    .optional(),
  ADMIN_PASSWORD: Joi.string().min(8).optional(),

  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').optional(),

  // Public base URL for INBOUND platform callbacks (OZON webhooks). The URL
  // configured in the OZON cabinet is built from this value; every store
  // shares the host and differs only by the storeCode path segment. Optional
  // so local development without a tunnel keeps booting. https-only - an
  // http callback URL could never be registered with the platform.
  // See docs/integrations/ozon-webhook-tunnel.md.
  PUBLIC_BASE_URL: Joi.string()
    .uri({ scheme: ['https'] })
    .optional(),

  // Fallback re-read rotation window for platform order facts (dual-axis
  // T2). Default 24h: webhooks carry changes in minutes; this bounds how
  // long an order can go unobserved when webhooks are unavailable.
  // Fractional hours allowed (integration tests use short windows).
  ORDER_STATE_FALLBACK_HOURS: Joi.number().min(0.001).default(24),

  // 面单后台任务（2026-10-21）：预取归档 + 终态清理。
  // 预取默认开启；DELAY 对应 OZON「组包后 45–60 秒再取面单」的建议。
  LABEL_PREFETCH_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  LABEL_PREFETCH_DELAY_MS: Joi.number().integer().min(0).default(60000),
  LABEL_PREFETCH_MAX_ATTEMPTS: Joi.number().integer().min(1).default(6),
  LABEL_PREFETCH_FROM_SYNC: Joi.boolean().truthy('true').falsy('false').default(true),
  LABEL_BATCH_FETCH_CHUNK: Joi.number().integer().min(1).default(20),
  // 清理是后台、用户不可见的维护任务，时效要求极低：默认 6 小时一次。
  // 单轮按游标循环若干批（默认 10 × 200 行），60 秒预算用于排空积压。
  LABEL_PURGE_SWEEP_INTERVAL_SECONDS: Joi.number().integer().min(30).default(21600),
  LABEL_PURGE_BATCH_SIZE: Joi.number().integer().min(1).default(200),
  LABEL_PURGE_MAX_BATCHES_PER_RUN: Joi.number().integer().min(1).default(10),
  LABEL_PURGE_MAX_RUN_MS: Joi.number().integer().min(1000).default(60000),
  LABEL_PURGE_GRACE_MINUTES: Joi.number().integer().min(0).default(0),

  // Optional Feishu webhook (Sprint 4): absent = FEISHU channel stays a
  // provider boundary only; never guessed (task §49).
  FEISHU_WEBHOOK_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional(),

  // Transactional email via Feishu SMTP (user management verification).
  // All optional at boot (empty string = unconfigured) so the system keeps
  // starting without email; the email features surface EMAIL_NOT_CONFIGURED
  // at runtime instead.
  SMTP_HOST: Joi.string().allow('').optional(),
  SMTP_PORT: Joi.number().port().default(465),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASSWORD: Joi.string().allow('').optional(),
  SMTP_FROM_NAME: Joi.string().optional(),

  // Browser-facing base URL for links inside verification emails.
  WEB_BASE_URL: Joi.string().uri().default('http://localhost:5173'),
}).unknown(true);
