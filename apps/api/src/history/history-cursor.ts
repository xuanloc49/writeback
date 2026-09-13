import { z } from 'zod';
import { appError } from '../common/app-error';

/** Keyset cursor on `(scored_at DESC, id DESC)`; opaque to clients (base64url JSON). */
export interface HistoryCursor {
  scoredAt: Date;
  id: string;
}

const cursorPayloadSchema = z.object({ s: z.string().datetime(), i: z.string().uuid() }).strict();

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  const payload = JSON.stringify({ s: cursor.scoredAt.toISOString(), i: cursor.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeHistoryCursor(raw: string): HistoryCursor {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw appError('VALIDATION', { reason: 'invalid_cursor' });
  }
  const parsed = cursorPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw appError('VALIDATION', { reason: 'invalid_cursor' });
  }
  return { scoredAt: new Date(parsed.data.s), id: parsed.data.i };
}
