import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { Response } from 'express';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { UserEntity } from '../entities/user.entity';
import { USER_STATUS_ACTIVE } from '../enums/user-status.enum';
import { LoginRequestDto } from '../dto/request/login.request.dto';
import { UserResponseDto } from '../dto/response/login.response.dto';
import { InvalidCredentialsError, TooManyLoginAttemptsError } from '../errors/auth-errors';
import { UserService } from './user.service';

export const AUTH_COOKIE_NAME = 'wcies_session';

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

/**
 * Sliding-session renewal threshold (2026-10-05): a session that has been
 * used at least once after this much token age gets a fresh full window
 * (JWT_EXPIRES_IN, default 7d). In practice this re-issues at most once per
 * day of activity, so an account in daily use never logs out while an idle
 * account still expires after the full window.
 */
const SESSION_RENEW_AFTER_MS = 24 * 3_600_000;

/** Parses simple duration strings (`8h`, `30m`, `7d`, `45s`) to milliseconds. */
export function parseDurationToMs(input: string): number | undefined {
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(input.trim());
  if (!match) {
    return undefined;
  }
  const amount = Number.parseInt(match[1] ?? '0', 10);
  const unit = (match[2] ?? 's').toLowerCase();
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * (multipliers[unit] ?? 1000);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * Validates credentials, issues a JWT and sets it as an HttpOnly cookie.
   * Login attempts are rate limited per client IP via Redis.
   */
  async login(
    dto: LoginRequestDto,
    clientIp: string,
    response: Response,
  ): Promise<UserResponseDto> {
    await this.enforceRateLimit(clientIp);

    const user = await this.userService.findByUsernameOrEmail(dto.usernameOrEmail);
    const passwordValid =
      user !== null &&
      user.status === USER_STATUS_ACTIVE &&
      (await argon2.verify(user.passwordHash, dto.password).catch(() => false));

    if (user === null || !passwordValid) {
      this.logger.warn('Login failed: invalid credentials', { module: 'auth', clientIp });
      throw new InvalidCredentialsError();
    }

    // A SUCCESSFUL login resets the counter: the limiter exists to throttle
    // password guessing, and counting successes instead locked out e.g. a
    // shared-IP office (or the serial integration suites, which log in once
    // per spec file through the same shared Redis DB) after five legitimate
    // logins in a minute.
    await this.redis.client.del(`auth:login:rate:${clientIp}`);

    const token = await this.signToken(user);
    this.setAuthCookie(response, token);
    this.logger.info('Login successful', { module: 'auth', clientIp, userId: user.id });
    return this.userService.toResponse(user);
  }

  logout(response: Response): void {
    response.clearCookie(AUTH_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<boolean>('app.isProduction') ?? false,
    });
  }

  verifyToken(token: string): Promise<{ sub: string; username: string; role: string }> {
    return this.jwtService.verifyAsync(token);
  }

  /**
   * Sliding renewal (2026-10-05): called by JwtAuthGuard AFTER the request is
   * fully authenticated (user active, not revoked). When the presented token
   * is older than SESSION_RENEW_AFTER_MS, mints a fresh full-window token and
   * resets the cookie - "used today" extends the session. At most one renewal
   * per day per client, so bursts do not re-sign every request.
   */
  async renewIfAging(
    user: UserEntity,
    tokenIat: number | undefined,
    response: Response,
  ): Promise<void> {
    if (tokenIat === undefined) {
      return;
    }
    const ageMs = Date.now() - tokenIat * 1000;
    if (ageMs < SESSION_RENEW_AFTER_MS) {
      return;
    }
    const token = await this.signToken(user);
    this.setAuthCookie(response, token);
    this.logger.debug(`session renewed (sliding window, userId=${user.id})`);
  }

  private signToken(user: UserEntity): Promise<string> {
    return this.jwtService.signAsync({
      sub: user.id,
      username: user.username,
      role: user.role,
    });
  }

  private setAuthCookie(response: Response, token: string): void {
    const expiresIn = this.config.get<string>('app.jwtExpiresIn') ?? '7d';
    const maxAgeMs = parseDurationToMs(expiresIn);
    response.cookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<boolean>('app.isProduction') ?? false,
      ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
    });
  }

  private async enforceRateLimit(clientIp: string): Promise<void> {
    const key = `auth:login:rate:${clientIp}`;
    const attempts = await this.redis.client.incr(key);
    if (attempts === 1) {
      await this.redis.client.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    }
    if (attempts > RATE_LIMIT_MAX_ATTEMPTS) {
      const ttl = await this.redis.client.ttl(key);
      throw new TooManyLoginAttemptsError(ttl > 0 ? ttl : RATE_LIMIT_WINDOW_SECONDS);
    }
  }
}
