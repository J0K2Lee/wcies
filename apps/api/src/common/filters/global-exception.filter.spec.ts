import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from './global-exception.filter';
import { AppLoggerService } from '../logger/app-logger.service';

interface CapturedResponse {
  status: number;
  body: unknown;
}

function runFilter(exception: unknown): CapturedResponse {
  const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as AppLoggerService;
  const filter = new GlobalExceptionFilter(logger);
  const captured: CapturedResponse = { status: 0, body: null };
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({
        status: (code: number) => ({
          json: (payload: unknown) => {
            captured.status = code;
            captured.body = payload;
          },
        }),
      }),
    }),
  } as unknown as ArgumentsHost;
  filter.catch(exception, host);
  return captured;
}

describe('GlobalExceptionFilter HTTP normalization', () => {
  it('does not mislabel Nest 404 bodies as validation failures', () => {
    // Shape of Nest's default NotFoundException body: it satisfies the
    // message + statusCode check and must NOT become COMMON_VALIDATION_FAILED.
    const captured = runFilter(new NotFoundException('Cannot POST /api/v1/warehouses//bins/batch'));

    expect(captured.status).toBe(404);
    const body = captured.body as {
      success: boolean;
      error: { code: string; message: string; details: Record<string, unknown> };
    };
    expect(body.error.code).toBe('COMMON_NOT_FOUND');
    expect(body.error.message).not.toBe('Request validation failed');
    expect(body.error.details.validationErrors).toBeUndefined();
  });

  it('keeps real 400 validation failures with array validationErrors', () => {
    // Shape produced by the global ValidationPipe on a real 400.
    const captured = runFilter(
      new BadRequestException({
        message: ['warehouseCode must be longer than or equal to 3 characters'],
        error: 'Bad Request',
        statusCode: 400,
      }),
    );

    expect(captured.status).toBe(400);
    const body = captured.body as {
      success: boolean;
      error: { code: string; message: string; details: { validationErrors: unknown } };
    };
    expect(body.error.code).toBe('COMMON_VALIDATION_FAILED');
    expect(body.error.message).toBe('Request validation failed');
    expect(Array.isArray(body.error.details.validationErrors)).toBe(true);
  });
});
