import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_HTTP_STATUS } from './errors.js';
import { isStaffRole, limitProfileFor } from './limits.js';

describe('limitProfileFor', () => {
  it('gives staff roles the staff profile regardless of plan', () => {
    expect(limitProfileFor('admin', 'free')).toBe('staff');
    expect(limitProfileFor('editor', 'premium')).toBe('staff');
    expect(limitProfileFor('support', 'free')).toBe('staff');
  });

  it('gives plain users their plan', () => {
    expect(limitProfileFor('user', 'free')).toBe('free');
    expect(limitProfileFor('user', 'premium')).toBe('premium');
    expect(isStaffRole('user')).toBe(false);
  });
});

describe('ERROR_HTTP_STATUS', () => {
  it('maps every code to the design §5.3 status', () => {
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ERROR_CODES].sort());
    expect(ERROR_HTTP_STATUS.UNAUTHENTICATED).toBe(401);
    expect(ERROR_HTTP_STATUS.NOT_FOUND).toBe(404);
    expect(ERROR_HTTP_STATUS.COPY_BLOCKED).toBe(422);
    expect(ERROR_HTTP_STATUS.SCORING_IN_PROGRESS).toBe(409);
    expect(ERROR_HTTP_STATUS.QUOTA_EXCEEDED).toBe(429);
    expect(ERROR_HTTP_STATUS.LLM_INVALID_SCHEMA).toBe(502);
    expect(ERROR_HTTP_STATUS.PAYLOAD_TOO_LARGE).toBe(413);
    expect(ERROR_HTTP_STATUS.INTERNAL).toBe(500);
  });
});
