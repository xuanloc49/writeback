import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_HTTP_STATUS, type ApiErrorEnvelope, type ErrorCode } from '@writeback/shared';
import { AppError, ERROR_MESSAGES_VI } from './app-error';
import { REQUEST_ID_HEADER, type AppRequest } from './request-context';

/** Renders every error as the design §5.2 envelope; never leaks internals. */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AppRequest>();
    const requestId = req.requestId ?? res.getHeader(REQUEST_ID_HEADER)?.toString() ?? '';

    const { status, code, message, details } = this.describe(exception);
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        JSON.stringify({ event: 'unhandled_error', request_id: requestId, code }),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: ApiErrorEnvelope = {
      error: { code, message, request_id: requestId, ...(details ? { details } : {}) },
    };
    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.status(status).json(body);
  }

  private describe(exception: unknown): {
    status: number;
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof AppError) {
      return {
        status: ERROR_HTTP_STATUS[exception.code],
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof HttpException) {
      const code = codeForHttpStatus(exception.getStatus());
      return { status: ERROR_HTTP_STATUS[code], code, message: ERROR_MESSAGES_VI[code] };
    }
    if (isBodyParserError(exception)) {
      const code = codeForHttpStatus(exception.status);
      return { status: ERROR_HTTP_STATUS[code], code, message: ERROR_MESSAGES_VI[code] };
    }
    return {
      status: ERROR_HTTP_STATUS.INTERNAL,
      code: 'INTERNAL',
      message: ERROR_MESSAGES_VI.INTERNAL,
    };
  }
}

function codeForHttpStatus(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'VALIDATION';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return 'PAYLOAD_TOO_LARGE';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL';
  }
}

function isBodyParserError(exception: unknown): exception is { status: number } {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    'status' in exception &&
    typeof (exception as { status: unknown }).status === 'number' &&
    'type' in exception
  );
}
