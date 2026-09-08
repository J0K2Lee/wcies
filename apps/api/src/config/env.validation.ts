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
  JWT_EXPIRES_IN: Joi.string().default('8h'),

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

  // Optional Feishu webhook (Sprint 4): absent = FEISHU channel stays a
  // provider boundary only; never guessed (task §49).
  FEISHU_WEBHOOK_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional(),
}).unknown(true);
