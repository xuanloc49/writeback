import type { QuotaLeft } from '../quota/quota.service';

/** PRD §10.7: the dashboard lists the 5 topics with the most visible cards. */
export const DASHBOARD_TOP_TOPICS = 5;
const PERCENT_SCALE = 100;

export type DashboardCta = 'rewrite' | 'review' | null;

export interface DashboardTopicView {
  topicId: string;
  nameVi: string;
  cardCount: number;
  masteredPercent: number;
}

/** `GET /v1/dashboard` — design §12.5, PRD §10.7. */
export interface DashboardResponse {
  streak: number;
  dueToday: number;
  reviewedToday: number;
  rewriteNewToday: number;
  quota: QuotaLeft;
  topics: DashboardTopicView[];
  cta: DashboardCta;
  hasCards: boolean;
}

export function percentOf(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * PERCENT_SCALE);
}
