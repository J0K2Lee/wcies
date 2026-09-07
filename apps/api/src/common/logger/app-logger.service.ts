import { Injectable, LoggerService } from '@nestjs/common';
import pino from 'pino';
import { getRequestContext } from '../context/request-context';

export type LoggerBindings = Record<string, unknown>;

const REDACT_PATHS = [
  'password',
  '*.password',
  'newPassword',
  '*.secret',
  '*.secretKey',
  '*.accessKey',
  '*.apiKey',
  '*.token',
  '*.authorization',
  '*.credential',
  '*.credentialPayload',
  'req.headers.authorization',
  'req.headers.cookie',
];

/**
 * Structured JSON logger (Pino) implementing the NestJS LoggerService.
 *
 * - requestId / userId / storeId / platform / jobId are injected automatically
 *   from the AsyncLocalStorage request context when present.
 * - Sensitive fields are redacted before serialization.
 * - Development prints pretty logs; production emits single-line JSON.
 */
@Injectable()
export class AppLoggerService implements LoggerService {
  private readonly logger: pino.Logger;

  constructor() {
    const isProduction = process.env.NODE_ENV === 'production';
    this.logger = pino({
      level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      base: { service: 'wcies-api' },
      ...(isProduction
        ? {}
        : { transport: { target: 'pino-pretty', options: { singleLine: true } } }),
    });
  }

  private contextBindings(): LoggerBindings {
    const ctx = getRequestContext();
    if (!ctx) {
      return {};
    }
    const bindings: LoggerBindings = { requestId: ctx.requestId };
    if (ctx.userId !== undefined) bindings.userId = ctx.userId;
    if (ctx.storeId !== undefined) bindings.storeId = ctx.storeId;
    if (ctx.platform !== undefined) bindings.platform = ctx.platform;
    if (ctx.jobId !== undefined) bindings.jobId = ctx.jobId;
    return bindings;
  }

  private toBindings(context?: LoggerBindings | string): LoggerBindings {
    return typeof context === 'string' ? { context } : (context ?? {});
  }

  /** Business-oriented log methods. */
  info(message: string, context?: LoggerBindings | string): void {
    this.logger.info({ ...this.contextBindings(), ...this.toBindings(context) }, message);
  }

  warn(message: string, context?: LoggerBindings | string): void {
    this.logger.warn({ ...this.contextBindings(), ...this.toBindings(context) }, message);
  }

  /** NestJS LoggerService surface. */
  log(message: string, context?: LoggerBindings | string): void {
    this.info(message, context);
  }

  error(message: string, stack?: string, context?: LoggerBindings | string): void {
    this.logger.error({ ...this.contextBindings(), ...this.toBindings(context), stack }, message);
  }

  debug(message: string, context?: LoggerBindings | string): void {
    this.logger.debug({ ...this.contextBindings(), ...this.toBindings(context) }, message);
  }

  verbose(message: string, context?: LoggerBindings | string): void {
    this.logger.trace({ ...this.contextBindings(), ...this.toBindings(context) }, message);
  }

  fatal(message: string, context?: LoggerBindings | string): void {
    this.logger.fatal({ ...this.contextBindings(), ...this.toBindings(context) }, message);
  }
}
