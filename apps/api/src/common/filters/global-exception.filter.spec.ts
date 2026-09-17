import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from './global-exception.filter';
import { AppLoggerService } from '../logger/app-logger.service';

interface CapturedResponse {
  status: number;
  body: unknown;
}

function runFilter(exception: unknown) {
  const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
  const filter = new GlobalExceptionFilter(logger as unknown as AppLoggerService);
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
  return { ...captured, logger };
}

describe('GlobalExceptionFilter HTTP normalization', () => {
  it('does not mislabel Nest 404 bodies as validation failures', () => {
    const message = 'Cannot POST /api/v1/warehouses//bins/batch';
    const captured = runFilter(new NotFoundException(message));

    expect(captured.status).toBe(404);
    expect(captured.body).toMatchObject({
      success: false,
      error: { code: 'COMMON_NOT_FOUND', message, details: {} },
    });
    expect(captured.logger.warn).toHaveBeenCalledWith(`Request failed: ${message}`, {
      module: 'http',
      statusCode: 404,
      errorCode: 'COMMON_NOT_FOUND',
    });
  });

  it.each([
    {
      validationErrors: [
        'warehouseCode must be longer than or equal to 3 characters',
        '金额格式错误（最多4位小数）',
      ],
      joined:
        'warehouseCode must be longer than or equal to 3 characters；金额格式错误（最多4位小数）',
    },
    { validationErrors: '金额格式错误（最多4位小数）', joined: '金额格式错误（最多4位小数）' },
  ])(
    'preserves validation constraints in the response and WARN log ($joined)',
    ({ validationErrors, joined }) => {
      const captured = runFilter(
        new BadRequestException({
          message: validationErrors,
          error: 'Bad Request',
          statusCode: 400,
          // Extra response fields must not be copied into logs.
          password: 'sensitive-submitted-value',
        }),
      );
      const message = `请求参数校验失败：${joined}`;

      expect(captured.status).toBe(400);
      expect(captured.body).toMatchObject({
        success: false,
        error: {
          code: 'COMMON_VALIDATION_FAILED',
          message,
          details: { validationErrors },
        },
      });
      expect(captured.logger.warn).toHaveBeenCalledExactlyOnceWith(`Request failed: ${message}`, {
        module: 'http',
        statusCode: 400,
        errorCode: 'COMMON_VALIDATION_FAILED',
        validationErrors,
      });
      expect(captured.logger.error).not.toHaveBeenCalled();
    },
  );
});
