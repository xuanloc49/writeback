import type { MeDto } from '@writeback/shared';
import { API_URL } from './config';
import { ApiError, parseApiError } from './api-error';

export { ApiError };

const REQUEST_ID_HEADER = 'X-Request-Id';

export function newRequestId(): string {
  return crypto.randomUUID();
}

export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has(REQUEST_ID_HEADER)) {
    headers.set(REQUEST_ID_HEADER, newRequestId());
  }
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const { json: _json, ...rest } = init;
  const res = await fetch(`${API_URL}/v1${path}`, {
    ...rest,
    headers,
    credentials: 'include',
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    throw parseApiError(body, res.status);
  }
  return body as T;
}

export async function apiGetMe(): Promise<MeDto | null> {
  try {
    return await api<MeDto>('/me');
  } catch (err) {
    if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
      return null;
    }
    throw err;
  }
}
