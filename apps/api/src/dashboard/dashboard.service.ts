import { Inject, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { businessDate, businessDayRange, isDueToday } from '@writeback/shared';
import { CLOCK, type Clock } from '../common/clock';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService, type QuotaLeft } from '../quota/quota.service';
import { visibleCardWhere } from '../vocab/card-visibility';
import {
  DASHBOARD_TOP_TOPICS,
  percentOf,
  type DashboardCta,
  type DashboardResponse,
  type DashboardTopicView,
} from './dashboard.dto';
import { dateColumnToBusinessDate, effectiveStreak } from './streak';

const FIRST_REVISION = 1;

interface VisibleCardRow {
  status: string;
  nextReviewAt: Date;
  lemma: { topicId: string; topic: { nameVi: string } };
}

interface TodayCounts {
  dueToday: number;
  reviewedToday: number;
  rewriteNewToday: number;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Design §12.5 / PRD §10.7. Due never includes hidden or content-gone cards. */
  async get(user: User): Promise<DashboardResponse> {
    const now = this.clock.now();
    const tz = this.config.businessTz;
    const { start, end } = businessDayRange(now, tz);
    const [cards, reviewedToday, rewriteNewToday, quota] = await Promise.all([
      this.prisma.srsCard.findMany({
        where: visibleCardWhere(user.id),
        select: {
          status: true,
          nextReviewAt: true,
          lemma: { select: { topicId: true, topic: { select: { nameVi: true } } } },
        },
      }),
      // Direct count over srs_reviews (joined via the user's cards) rather than the
      // user_daily_activity roll-up, so the widget is correct even if the roll-up lags.
      this.prisma.srsReview.count({
        where: { card: { userId: user.id }, createdAt: { gte: start, lt: end } },
      }),
      this.prisma.rewriteAttempt.count({
        where: {
          userId: user.id,
          revision: FIRST_REVISION,
          quotaCharged: true,
          scoredAt: { gte: start, lt: end },
        },
      }),
      this.prisma.$transaction((tx) => this.quota.remaining(tx, user, now)),
    ]);
    const dueToday = cards.filter((card) => isDueToday(card.nextReviewAt, now, tz)).length;
    const counts: TodayCounts = { dueToday, reviewedToday, rewriteNewToday };
    return {
      streak: effectiveStreak(
        user.streakCount,
        dateColumnToBusinessDate(user.streakLastDate),
        businessDate(now, tz),
      ),
      ...counts,
      quota,
      topics: topTopics(cards),
      cta: chooseCta(cards.length > 0, counts, quota),
      hasCards: cards.length > 0,
    };
  }
}

/** PRD §10.7: 5 topics with the most visible cards, with % mastered. */
function topTopics(cards: VisibleCardRow[]): DashboardTopicView[] {
  const byTopic = new Map<string, { nameVi: string; cardCount: number; mastered: number }>();
  for (const card of cards) {
    const entry = byTopic.get(card.lemma.topicId) ?? {
      nameVi: card.lemma.topic.nameVi,
      cardCount: 0,
      mastered: 0,
    };
    entry.cardCount += 1;
    if (card.status === 'mastered') {
      entry.mastered += 1;
    }
    byTopic.set(card.lemma.topicId, entry);
  }
  return [...byTopic.entries()]
    .map(([topicId, entry]) => ({
      topicId,
      nameVi: entry.nameVi,
      cardCount: entry.cardCount,
      masteredPercent: percentOf(entry.mastered, entry.cardCount),
    }))
    .sort((a, b) => b.cardCount - a.cardCount || a.nameVi.localeCompare(b.nameVi, 'vi'))
    .slice(0, DASHBOARD_TOP_TOPICS);
}

/**
 * PRD §10.7: no cards → guide to a first rewrite; due but nothing reviewed → "Ôn ngay";
 * nothing written yet and quota left → "Viết lại"; otherwise no CTA.
 */
function chooseCta(hasCards: boolean, counts: TodayCounts, quota: QuotaLeft): DashboardCta {
  if (!hasCards) {
    return 'rewrite';
  }
  if (counts.dueToday > 0 && counts.reviewedToday === 0) {
    return 'review';
  }
  if (counts.rewriteNewToday === 0 && quota.rewriteNewLeft > 0) {
    return 'rewrite';
  }
  return null;
}
