import { Injectable } from '@nestjs/common';
import type { Lemma, SrsCard } from '@prisma/client';
import { businessDate, businessDayRange, isDueToday } from '@writeback/shared';
import { AppConfig } from '../config/app-config';
import type { Tx } from '../prisma/prisma.service';

export type QueueTopic = { nameVi: string; status: string; deletedAt: Date | null };
export type QueueCard = SrsCard & { lemma: Lemma & { topic: QueueTopic } };

/** Design §10 queue order: overdue (longest first) → learning → due today → new. */
const TIER_OVERDUE = 0;
const TIER_LEARNING = 1;
const TIER_DUE_TODAY = 2;
const TIER_NEW = 3;

export function queueTier(
  card: Pick<SrsCard, 'status' | 'nextReviewAt'>,
  now: Date,
  tz: string,
): number {
  if (card.status === 'new') {
    return TIER_NEW;
  }
  if (businessDate(card.nextReviewAt, tz) < businessDate(now, tz)) {
    return TIER_OVERDUE;
  }
  return card.status === 'learning' ? TIER_LEARNING : TIER_DUE_TODAY;
}

/** Pure ordering of already-filtered due cards; ties broken by `nextReviewAt` then id. */
export function orderQueue<T extends Pick<SrsCard, 'id' | 'status' | 'nextReviewAt'>>(
  cards: readonly T[],
  now: Date,
  tz: string,
): T[] {
  return [...cards].sort((a, b) => {
    const tierDiff = queueTier(a, now, tz) - queueTier(b, now, tz);
    if (tierDiff !== 0) {
      return tierDiff;
    }
    const timeDiff = a.nextReviewAt.getTime() - b.nextReviewAt.getTime();
    return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id);
  });
}

/**
 * Review queue (design §5.1, §7.4, §10): cards of the user that are visible for review
 * (`hidden_at IS NULL`, lemma + topic published and not soft-deleted) and due today in
 * `BUSINESS_TZ`, minus the ones already graded in the current session.
 */
@Injectable()
export class ReviewQueueService {
  constructor(private readonly config: AppConfig) {}

  async dueCards(
    tx: Tx,
    userId: string,
    now: Date,
    excludeCardIds: readonly string[] = [],
  ): Promise<QueueCard[]> {
    const tz = this.config.businessTz;
    const { end } = businessDayRange(now, tz);
    const cards = await tx.srsCard.findMany({
      where: {
        userId,
        hiddenAt: null,
        nextReviewAt: { lt: end },
        ...(excludeCardIds.length > 0 ? { id: { notIn: [...excludeCardIds] } } : {}),
        lemma: {
          deletedAt: null,
          status: 'published',
          topic: { deletedAt: null, status: 'published' },
        },
      },
      include: {
        lemma: { include: { topic: { select: { nameVi: true, status: true, deletedAt: true } } } },
      },
    });
    const due = cards.filter((card) => isDueToday(card.nextReviewAt, now, tz));
    return orderQueue(due, now, tz);
  }

  /** Ids of cards already graded in `sessionId` (never served twice in one session). */
  async gradedCardIds(tx: Tx, sessionId: string): Promise<string[]> {
    const rows = await tx.srsReview.findMany({ where: { sessionId }, select: { cardId: true } });
    return rows.map((row) => row.cardId);
  }
}
