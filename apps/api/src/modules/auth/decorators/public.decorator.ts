import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'isPublicRoute';

/** Marks a route as excluded from the global JWT guard. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
