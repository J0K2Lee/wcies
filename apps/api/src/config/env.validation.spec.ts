import { describe, expect, it } from 'vitest';
import { envValidationSchema } from '../config/env.validation';

const VALID_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'postgresql://wcies:pw@localhost:5432/wcies_dev',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: '0123456789abcdef0123456789abcdef',
  CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'user',
  S3_SECRET_KEY: 'secret',
  S3_BUCKET: 'wcies',
};

describe('envValidationSchema', () => {
  it('accepts a complete valid environment', () => {
    const { error, value } = envValidationSchema.validate(VALID_ENV, {
      allowUnknown: true,
    });
    expect(error).toBeUndefined();
    expect(value).toMatchObject({ NODE_ENV: 'development', PORT: 3000 });
  });

  it('fails when DATABASE_URL is missing', () => {
    const env = { ...VALID_ENV };
    delete env.DATABASE_URL;
    const { error } = envValidationSchema.validate(env, { allowUnknown: true });
    expect(error?.message).toContain('DATABASE_URL');
  });

  it('fails when REDIS_URL scheme is not redis/rediss', () => {
    const { error } = envValidationSchema.validate(
      { ...VALID_ENV, REDIS_URL: 'http://localhost:6379' },
      { allowUnknown: true },
    );
    expect(error?.message).toContain('REDIS_URL');
  });

  it('fails when JWT_SECRET is shorter than 32 chars', () => {
    const { error } = envValidationSchema.validate(
      { ...VALID_ENV, JWT_SECRET: 'short' },
      { allowUnknown: true },
    );
    expect(error?.message).toContain('JWT_SECRET');
  });

  it('fails when CREDENTIAL_ENCRYPTION_KEY is not 64-char hex', () => {
    const { error } = envValidationSchema.validate(
      { ...VALID_ENV, CREDENTIAL_ENCRYPTION_KEY: 'xyz' },
      { allowUnknown: true },
    );
    expect(error?.message).toContain('CREDENTIAL_ENCRYPTION_KEY');
  });

  it('rejects invalid NODE_ENV', () => {
    const { error } = envValidationSchema.validate(
      { ...VALID_ENV, NODE_ENV: 'staging' },
      { allowUnknown: true },
    );
    expect(error?.message).toContain('NODE_ENV');
  });

  it('applies defaults for optional fields', () => {
    const { value } = envValidationSchema.validate(
      { ...VALID_ENV, PORT: undefined, S3_FORCE_PATH_STYLE: undefined },
      { allowUnknown: true },
    );
    expect(value.PORT).toBe(3000);
    expect(value.S3_FORCE_PATH_STYLE).toBe(true);
  });
});
