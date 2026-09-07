import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { requestContextStorage } from '../context/request-context';

/**
 * Express middleware: assigns a request id to every incoming request.
 *
 * - Reuses `X-Request-ID` from the incoming request (e.g. reverse proxy) when present.
 * - Otherwise generates a UUID.
 * - Echoes it back on the `X-Request-ID` response header.
 * - Opens the AsyncLocalStorage context so filters/loggers can read the id.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const headerValue = req.headers['x-request-id'];
  const incoming = (Array.isArray(headerValue) ? headerValue[0] : headerValue)?.trim();
  const requestId = incoming && incoming.length > 0 ? incoming : randomUUID();

  res.setHeader('X-Request-ID', requestId);
  requestContextStorage.run({ requestId }, next);
}
