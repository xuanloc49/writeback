import { ApiError } from './api-error';

function issueText(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const rec = value as Record<string, unknown>;
  const path = typeof rec.path === 'string' ? rec.path : '';
  const code = typeof rec.code === 'string' ? rec.code : '';
  const message = typeof rec.message === 'string' ? rec.message : '';
  const bit = [path || code, message].filter((part) => part.length > 0).join(': ');
  return bit.length > 0 ? bit : null;
}

/** Surfaces publish reasons, Zod issues, and singular API reason codes on staff banners. */
export function formatAdminError(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) {
    return fallback;
  }
  const extras: string[] = [];
  const reasons = err.details?.reasons;
  if (Array.isArray(reasons)) {
    extras.push(...reasons.map(String));
  }
  const reason = err.details?.reason;
  if (typeof reason === 'string' && reason.length > 0) {
    extras.push(reason);
  }
  const field = err.details?.field;
  if (typeof field === 'string' && field.length > 0) {
    extras.push(field);
  }
  const issues = err.details?.issues;
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      const text = issueText(issue);
      if (text !== null) {
        extras.push(text);
      }
    }
  }
  const errors = err.details?.errors;
  if (Array.isArray(errors)) {
    for (const item of errors) {
      const text = issueText(item);
      if (text !== null) {
        extras.push(text);
      }
    }
  }
  if (extras.length === 0) {
    return err.message;
  }
  return `${err.message} ${extras.join(', ')}`;
}
