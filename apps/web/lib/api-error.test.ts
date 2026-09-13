import { describe, expect, it } from 'vitest';
import { parseApiError } from './api-error';

describe('parseApiError', () => {
  it('reads the design envelope', () => {
    const err = parseApiError(
      {
        error: {
          code: 'QUOTA_EXCEEDED',
          message: 'Bạn đã hết lượt viết lại hôm nay. Lượt mới vào 00:00 GMT+7.',
          request_id: 'req-1',
          details: { resetAt: '2026-09-14T17:00:00.000Z', scope: 'rewrite_new' },
        },
      },
      429,
    );
    expect(err.code).toBe('QUOTA_EXCEEDED');
    expect(err.message).toContain('hết lượt');
    expect(err.requestId).toBe('req-1');
    expect(err.status).toBe(429);
    expect(err.resetAt).toBe('2026-09-14T17:00:00.000Z');
    expect(err.details?.scope).toBe('rewrite_new');
  });

  it('falls back when the body is not an envelope', () => {
    const err = parseApiError({ nope: true }, 500);
    expect(err.code).toBe('INTERNAL');
    expect(err.status).toBe(500);
  });
});
