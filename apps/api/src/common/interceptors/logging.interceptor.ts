import { Injectable, CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { tap, Observable } from 'rxjs';
import { AppLoggerService } from '../logger/app-logger.service';

/** Logs one structured access-log line per finished HTTP request. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: AppLoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        response.on('finish', () => {
          this.logger.info('HTTP request completed', {
            module: 'http-access',
            method: request.method,
            url: request.originalUrl,
            statusCode: response.statusCode,
            durationMs: Date.now() - startedAt,
          });
        });
      }),
    );
  }
}
