import { z } from 'zod';

/** `GET /v1/history` page sizes — design §12.5. */
export const HISTORY_PAGE_DEFAULT = 20;
export const HISTORY_PAGE_MAX = 50;
/** Excerpt = first N characters of `user_en`, followed by an ellipsis when truncated. */
export const HISTORY_EXCERPT_LENGTH = 120;
export const HISTORY_EXCERPT_ELLIPSIS = '…';

export const historyQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(HISTORY_PAGE_MAX).default(HISTORY_PAGE_DEFAULT),
  })
  .strict();
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

export interface HistoryItemView {
  attemptId: string;
  createdAt: string;
  scoredAt: string;
  topicNameVi: string;
  overallScore: number;
  excerpt: string;
  hasRevision: boolean;
  revisionScore: number | null;
}

/** `GET /v1/history` — design §12.5, PRD §10.8. */
export interface HistoryListResponse {
  items: HistoryItemView[];
  nextCursor: string | null;
}

export function excerptOf(userEn: string): string {
  if (userEn.length <= HISTORY_EXCERPT_LENGTH) {
    return userEn;
  }
  return userEn.slice(0, HISTORY_EXCERPT_LENGTH).trimEnd() + HISTORY_EXCERPT_ELLIPSIS;
}
