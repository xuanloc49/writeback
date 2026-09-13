import { ERROR_CODES, type ApiErrorEnvelope, type ErrorCode } from '@writeback/shared';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly requestId: string,
    readonly details?: Record<string, unknown>,
    readonly resetAt?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

function isEnvelope(body: unknown): body is ApiErrorEnvelope {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return false;
  }
  const error = (body as { error: unknown }).error;
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const rec = error as Record<string, unknown>;
  return (
    typeof rec.code === 'string' &&
    typeof rec.message === 'string' &&
    typeof rec.request_id === 'string'
  );
}

export function parseApiError(body: unknown, status: number): ApiError {
  if (isEnvelope(body)) {
    const details = body.error.details;
    const resetAt = typeof details?.resetAt === 'string' ? details.resetAt : undefined;
    return new ApiError(
      isErrorCode(body.error.code) ? body.error.code : 'INTERNAL',
      body.error.message,
      status,
      body.error.request_id,
      details,
      resetAt,
    );
  }
  return new ApiError('INTERNAL', 'Có lỗi xảy ra. Vui lòng thử lại sau.', status, '');
}
