import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { OperatorContext } from '../../modules/operation-log/operation-log.service';

interface RequestWithUser {
  user?: { id: string; username: string; role: string };
}

/**
 * Extracts the acting user from the JWT-authenticated request for operation
 * logging. Falls back to `system` for internal calls (guards guarantee a
 * user on every non-public route).
 */
export const CurrentOperator = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OperatorContext => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return {
      userId: request.user?.id ?? null,
      username: request.user?.username ?? 'system',
    };
  },
);
