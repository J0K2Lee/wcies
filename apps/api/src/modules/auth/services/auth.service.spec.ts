import { describe, expect, it, vi } from 'vitest';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { UserEntity } from '../entities/user.entity';
import { AuthService } from './auth.service';
import { UserService } from './user.service';

function userEntity(): UserEntity {
  return {
    id: 'user-1',
    username: 'alice',
    email: 'a@b.co',
    passwordHash: 'hash',
    status: 'ACTIVE',
    role: 'OPERATOR',
    emailVerifiedAt: new Date(),
    passwordChangedAt: new Date('2026-10-01T00:00:00Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function build() {
  const userService = {} as UserService;
  const jwtService = { signAsync: vi.fn(async () => 'fresh-token') };
  const config = {
    get: vi.fn((key: string) => (key === 'app.jwtExpiresIn' ? '7d' : false)),
  } as unknown as ConfigService;
  const redis = {} as RedisService;
  const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as AppLoggerService;
  const service = new AuthService(
    userService,
    jwtService as unknown as JwtService,
    config,
    redis,
    logger,
  );
  const response = { cookie: vi.fn() } as unknown as Response;
  return { service, jwtService, response };
}

describe('AuthService.renewIfAging (sliding sessions, 2026-10-05)', () => {
  it('re-issues a fresh full-window token and resets the cookie when the token is older than 24h', async () => {
    const { service, jwtService, response } = build();
    const twoDaysAgo = Math.floor((Date.now() - 48 * 3_600_000) / 1000);
    await service.renewIfAging(userEntity(), twoDaysAgo, response);
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1', role: 'OPERATOR' }),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'wcies_session',
      'fresh-token',
      expect.objectContaining({ maxAge: 7 * 24 * 3_600_000, httpOnly: true }),
    );
  });

  it('does nothing for a fresh token (under the 24h threshold) - one renewal per day of use', async () => {
    const { service, jwtService, response } = build();
    const oneHourAgo = Math.floor((Date.now() - 3_600_000) / 1000);
    await service.renewIfAging(userEntity(), oneHourAgo, response);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('skips tokens without an iat claim', async () => {
    const { service, jwtService, response } = build();
    await service.renewIfAging(userEntity(), undefined, response);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });
});
