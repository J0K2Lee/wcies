import {
  Catch,
  HttpException,
  ArgumentsHost,
  ExceptionFilter as NestExceptionFilterInterface,
} from '@nestjs/common';
import { EntityNotFoundError, QueryFailedError, TypeORMError } from 'typeorm';
import { Response } from 'express';
import { getRequestId } from '../context/request-context';
import { DomainError } from '../errors/domain.error';
import { DatabaseDomainError, InternalDomainError } from '../errors/common-errors';
import { AppLoggerService } from '../logger/app-logger.service';

interface NormalizedError {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

const HTTP_STATUS_TO_CODE: Readonly<Record<number, string>> = {
  400: 'COMMON_BAD_REQUEST',
  401: 'AUTH_UNAUTHORIZED',
  403: 'AUTH_FORBIDDEN',
  404: 'COMMON_NOT_FOUND',
  409: 'COMMON_CONFLICT',
  410: 'COMMON_GONE',
  415: 'COMMON_UNSUPPORTED_MEDIA_TYPE',
  422: 'COMMON_UNPROCESSABLE_ENTITY',
  429: 'COMMON_TOO_MANY_REQUESTS',
  503: 'COMMON_SERVICE_UNAVAILABLE',
};

/**
 * Global exception filter: converts every thrown error into the unified
 * envelope `{ success:false, error:{code,message,details}, requestId }`.
 *
 * Handles, in order: DomainError, HttpException (incl. DTO validation),
 * TypeORM errors, unknown errors. SQL, stack traces and secrets are logged
 * server-side only and never returned to clients (Sprint 0 task §12).
 */
@Catch()
export class GlobalExceptionFilter implements NestExceptionFilterInterface<unknown> {
  constructor(private readonly logger: AppLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const normalized = this.normalize(exception);
    const logBindings = {
      module: 'http',
      statusCode: normalized.status,
      errorCode: normalized.code,
    };

    if (normalized.status >= 500) {
      this.logger.error(
        `Unhandled error: ${normalized.message}`,
        exception instanceof Error ? (exception.stack ?? undefined) : undefined,
        logBindings,
      );
    } else {
      this.logger.warn(`Request failed: ${normalized.message}`, logBindings);
    }

    response.status(normalized.status).json({
      success: false as const,
      error: {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details,
      },
      requestId: getRequestId(),
    });
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof DomainError) {
      return {
        status: exception.httpStatus,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      return this.normalizeHttpException(status, body);
    }

    if (
      exception instanceof QueryFailedError ||
      exception instanceof EntityNotFoundError ||
      exception instanceof TypeORMError
    ) {
      // Log the driver-level detail server-side only.
      this.logger.error('Database error', exception.stack, {
        module: 'database',
        driverError: exception.message,
      });
      const mapped = new DatabaseDomainError();
      return { status: mapped.httpStatus, code: mapped.code, message: mapped.message, details: {} };
    }

    const fallback = new InternalDomainError();
    return {
      status: fallback.httpStatus,
      code: fallback.code,
      message: fallback.message,
      details: {},
    };
  }

  private normalizeHttpException(status: number, body: string | object): NormalizedError {
    // code and message must share the exact same predicate: a Nest default
    // 404 body ({message, error, statusCode}) also satisfies the shape check,
    // so gating on status === 400 is what keeps 404s from being mislabeled
    // as validation failures.
    const isValidation = status === 400 && this.isValidationBody(body);
    const code = isValidation
      ? 'COMMON_VALIDATION_FAILED'
      : (HTTP_STATUS_TO_CODE[status] ?? 'COMMON_HTTP_ERROR');

    let message: string;
    const details: Record<string, unknown> = {};

    if (typeof body === 'string') {
      message = body;
    } else if (isValidation) {
      details.validationErrors = body.message;
      message = 'Request validation failed';
    } else if ('message' in body && typeof body.message === 'string') {
      message = body.message;
    } else {
      message = 'HTTP error';
    }

    return { status, code, message, details };
  }

  private isValidationBody(
    body: string | object,
  ): body is { message: string[] | string; error: string; statusCode: number } {
    return (
      typeof body !== 'string' &&
      'message' in body &&
      (Array.isArray(body.message) || typeof body.message === 'string') &&
      'statusCode' in body
    );
  }
}
