import { describe, expect, it } from 'vitest';
import { ApiError } from './api-error';
import { formatAdminError } from './admin-error';

describe('formatAdminError', () => {
  it('appends publish reason codes from details', () => {
    const err = new ApiError('VALIDATION', 'Dữ liệu gửi lên không hợp lệ.', 422, 'r1', {
      reasons: ['sample_en_missing', 'target_not_published'],
    });
    expect(formatAdminError(err, 'fallback')).toContain('sample_en_missing');
    expect(formatAdminError(err, 'fallback')).toContain('target_not_published');
  });

  it('uses the fallback for unknown errors', () => {
    expect(formatAdminError(new Error('nope'), 'Không lưu được.')).toBe('Không lưu được.');
  });

  it('appends a conflict field name', () => {
    const err = new ApiError('CONFLICT', 'Xung đột dữ liệu.', 409, 'r2b', { field: 'headword' });
    expect(formatAdminError(err, 'fallback')).toBe('Xung đột dữ liệu. headword');
  });

  it('appends a singular reason code', () => {
    const err = new ApiError('CONFLICT', 'Xung đột dữ liệu.', 409, 'r2', {
      reason: 'email_exists',
    });
    expect(formatAdminError(err, 'fallback')).toBe('Xung đột dữ liệu. email_exists');
  });

  it('appends Zod issue path and message', () => {
    const err = new ApiError('VALIDATION', 'Dữ liệu gửi lên không hợp lệ.', 422, 'r3', {
      issues: [{ path: 'slug', message: 'slug must be kebab-case' }],
    });
    expect(formatAdminError(err, 'fallback')).toContain('slug: slug must be kebab-case');
  });

  it('appends import row errors from commit failures', () => {
    const err = new ApiError('VALIDATION', 'Dữ liệu gửi lên không hợp lệ.', 422, 'r4', {
      errors: [{ code: 'unknown_topic', message: 'topic slug missing' }],
    });
    expect(formatAdminError(err, 'fallback')).toContain('unknown_topic: topic slug missing');
  });
});
