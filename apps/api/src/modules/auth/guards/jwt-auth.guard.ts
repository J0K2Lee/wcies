import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { requestContextStorage } from '../../../common/context/request-context';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { UnauthorizedError } from '../errors/auth-errors';
import { USER_STATUS_ACTIVE } from '../enums/user-status.enum';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; username: string; role: string };
}

/**
 * Global authentication guard. Every route requires a valid session cookie
 * unless it is explicitly marked with @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const token = cookies?.['wcies_session'];
    if (token === undefined) {
      throw new UnauthorizedError();
    }

    let payload: { sub: string; username: string; role: string; iat?: number };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedError('Session expired or invalid');
    }

    const user = await this.userService.findById(payload.sub);
    if (user === null || user.status !== USER_STATUS_ACTIVE) {
      throw new UnauthorizedError();
    }
    // Session revocation: cookies issued before the last password change
    // stop authenticating (docs/business-rules/users.md). iat is seconds;
    // the +1s shift tolerates tokens minted within the same second as the
    // change without letting pre-change tokens through.
    if (payload.iat !== undefined && (payload.iat + 1) * 1000 < user.passwordChangedAt.getTime()) {
      throw new UnauthorizedError('Session expired or invalid');
    }

    request.user = { id: user.id, username: user.username, role: user.role };
    const store = requestContextStorage.getStore();
    if (store !== undefined) {
      store.userId = user.id;
    }
    // Sliding session: a token older than the renewal threshold gets a fresh
    // full window. Only reached on fully authenticated requests, so revoked
    // / disabled sessions never renew (AuthService.renewIfAging).
    await this.authService.renewIfAging(
      user,
      payload.iat,
      context.switchToHttp().getResponse<Response>(),
    );
    return true;
  }
}
