import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenError, UnauthorizedError } from '../errors/auth-errors';
import { USER_ROLE_ADMIN } from '../enums/user-role.enum';
import { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Route guard for admin-only operations (Sprint 1: credential writes,
 * spec §115). Runs after the global JwtAuthGuard, so request.user is set.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user === undefined) {
      // Only reachable when the route is @Public - admin routes never are.
      throw new UnauthorizedError();
    }
    if (request.user.role !== USER_ROLE_ADMIN) {
      throw new ForbiddenError();
    }
    return true;
  }
}
