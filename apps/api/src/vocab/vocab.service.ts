import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { isDueToday, normalizeHeadword, scoringOutputSchema } from '@writeback/shared';
import { AnalyticsService } from '../analytics/analytics.service';
import { appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { ALIVE_LEMMA_WHERE, hiddenCardWhere, visibleCardWhere } from './card-visibility';
import {
  EXAMPLE_SENTENCE_LABEL_VI,
  VOCAB_DETAIL_ATTEMPT_SCAN_LIMIT,
  VOCAB_DETAIL_MAX_USER_SENTENCES,
  type HiddenCardView,
  type HideCardResult,
  type SentenceView,
  type UnhideCardResult,
  type UserSentenceView,
  type VocabDetailResponse,
  type VocabListResponse,
  type VocabTopicGroup,
} from './vocab.dto';

export interface UndoAutoAddResult {
  cardId: string;
  hiddenAt: string;
}

const listCardSelect = {
  id: true,
  lemmaId: true,
  status: true,
  nextReviewAt: true,
  hiddenAt: true,
  lemma: {
    select: {
      headword: true,
      senseVi: true,
      topicId: true,
      topic: { select: { nameVi: true } },
    },
  },
} satisfies Prisma.SrsCardSelect;

type ListCardRow = Prisma.SrsCardGetPayload<{ select: typeof listCardSelect }>;

@Injectable()
export class VocabService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** PRD §10.5: no manual add. */
  addManually(): never {
    throw appError('FORBIDDEN', { reason: 'manual_add_disabled' });
  }

  /**
   * Design §12.3: visible cards grouped by topic plus the "Đã gỡ" list. Cards whose content is
   * gone (lemma/topic unpublished or soft-deleted) appear in neither group.
   */
  async list(user: User): Promise<VocabListResponse> {
    const now = this.clock.now();
    const rows = await this.prisma.srsCard.findMany({
      where: { userId: user.id, lemma: ALIVE_LEMMA_WHERE },
      select: listCardSelect,
      orderBy: [{ lemma: { headword: 'asc' } }, { id: 'asc' }],
    });
    const groups = new Map<string, VocabTopicGroup>();
    const hidden: HiddenCardView[] = [];
    for (const row of rows) {
      if (row.hiddenAt !== null) {
        hidden.push({
          cardId: row.id,
          lemmaId: row.lemmaId,
          headword: row.lemma.headword,
          topicNameVi: row.lemma.topic.nameVi,
        });
        continue;
      }
      const group = groups.get(row.lemma.topicId) ?? {
        topicId: row.lemma.topicId,
        nameVi: row.lemma.topic.nameVi,
        cards: [],
      };
      group.cards.push(this.cardView(row, now));
      groups.set(row.lemma.topicId, group);
    }
    const topics = [...groups.values()].sort((a, b) => a.nameVi.localeCompare(b.nameVi, 'vi'));
    return { topics, hidden };
  }

  /** Design §12.3 / PRD §10.5: 200 only for a visible card; hidden / no card / content gone → 404. */
  async detail(user: User, lemmaId: string): Promise<VocabDetailResponse> {
    const card = await this.prisma.srsCard.findFirst({
      where: { ...visibleCardWhere(user.id), lemmaId },
      include: { lemma: { include: { topic: { select: { nameVi: true } } } } },
    });
    if (card === null) {
      throw appError('NOT_FOUND');
    }
    const userSentences = await this.userSentences(user.id, card.lemmaId, card.lemma.headword);
    const sentences: SentenceView[] =
      userSentences.length > 0
        ? userSentences
        : card.lemma.exampleEn === null
          ? []
          : [{ text: card.lemma.exampleEn, source: 'example', label: EXAMPLE_SENTENCE_LABEL_VI }];
    return {
      lemma: {
        lemmaId: card.lemmaId,
        headword: card.lemma.headword,
        pos: card.lemma.pos,
        phonetic: card.lemma.phonetic,
        senseVi: card.lemma.senseVi,
        notesVi: card.lemma.notesVi,
        exampleEn: card.lemma.exampleEn,
        topicNameVi: card.lemma.topic.nameVi,
      },
      srs: {
        status: card.status,
        nextReviewAt: card.nextReviewAt.toISOString(),
        intervalDays: card.intervalDays,
        ef: card.ef,
        repetitions: card.repetitions,
      },
      sentences,
    };
  }

  /** Design §12.3 "Gỡ bộ ôn": hide the user's visible card for this lemma; SM-2 untouched. */
  async hide(user: User, lemmaId: string): Promise<HideCardResult> {
    const card = await this.prisma.srsCard.findFirst({
      where: { ...visibleCardWhere(user.id), lemmaId },
      select: { id: true },
    });
    if (card === null) {
      throw appError('NOT_FOUND');
    }
    const hiddenAt = this.clock.now();
    await this.prisma.srsCard.update({ where: { id: card.id }, data: { hiddenAt } });
    return { cardId: card.id, lemmaId, hiddenAt: hiddenAt.toISOString() };
  }

  /**
   * Design §9.4 unhide: own card, `hidden_at` set, content still alive → `hidden_at = NULL`.
   * SM-2 and `counted_toward_daily_new` are untouched (PRD §10.5).
   */
  async unhide(user: User, lemmaId: string, requestId: string): Promise<UnhideCardResult> {
    const card = await this.prisma.srsCard.findFirst({
      where: { ...hiddenCardWhere(user.id), lemmaId },
      select: { id: true },
    });
    if (card === null) {
      throw appError('NOT_FOUND');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.srsCard.update({ where: { id: card.id }, data: { hiddenAt: null } });
      await this.analytics.track(
        'vocab_unhidden',
        user.id,
        { card_id: card.id, lemma_id: lemmaId },
        requestId,
        tx,
      );
    });
    return { cardId: card.id, lemmaId };
  }

  /**
   * Hide an auto-added card. The card must belong to the user, have been created
   * from an attempt, be counted toward the daily-new cap (used ∧ natural) and not
   * already be hidden; any ownership/eligibility failure surfaces as NOT_FOUND.
   */
  async undoAutoAdd(user: User, cardId: string): Promise<UndoAutoAddResult> {
    const card = await this.prisma.srsCard.findFirst({
      where: {
        id: cardId,
        userId: user.id,
        hiddenAt: null,
        countedTowardDailyNew: true,
        addedFromAttemptId: { not: null },
      },
    });
    if (card === null) {
      throw appError('NOT_FOUND');
    }
    const hiddenAt = this.clock.now();
    await this.prisma.srsCard.update({ where: { id: card.id }, data: { hiddenAt } });
    return { cardId: card.id, hiddenAt: hiddenAt.toISOString() };
  }

  private cardView(row: ListCardRow, now: Date) {
    return {
      cardId: row.id,
      lemmaId: row.lemmaId,
      headword: row.lemma.headword,
      senseVi: row.lemma.senseVi,
      status: row.status,
      nextReviewAt: row.nextReviewAt.toISOString(),
      dueToday: isDueToday(row.nextReviewAt, now, this.config.businessTz),
    };
  }

  /**
   * PRD §10.5: newest-first `user_en` of scored attempts (any revision) whose stored feedback
   * marks this lemma `used: true`, capped at VOCAB_DETAIL_MAX_USER_SENTENCES.
   */
  private async userSentences(
    userId: string,
    lemmaId: string,
    headword: string,
  ): Promise<UserSentenceView[]> {
    const rows = await this.prisma.rewriteAttempt.findMany({
      where: {
        userId,
        status: 'scored',
        userEn: { not: null },
        scoredAt: { not: null },
        targetsSnapshot: { array_contains: [{ lemmaId }] },
      },
      orderBy: [{ scoredAt: 'desc' }, { id: 'desc' }],
      take: VOCAB_DETAIL_ATTEMPT_SCAN_LIMIT,
      select: { attemptId: true, userEn: true, scoredAt: true, feedback: true },
    });
    const wanted = normalizeHeadword(headword);
    const sentences: UserSentenceView[] = [];
    for (const row of rows) {
      if (row.userEn === null || row.scoredAt === null) {
        continue;
      }
      const parsed = scoringOutputSchema.safeParse(row.feedback);
      if (!parsed.success) {
        continue;
      }
      const entry = parsed.data.used_required_words.find(
        (w) => normalizeHeadword(w.headword) === wanted,
      );
      if (entry === undefined || !entry.used) {
        continue;
      }
      sentences.push({
        text: row.userEn,
        attemptId: row.attemptId,
        scoredAt: row.scoredAt.toISOString(),
        source: 'user',
      });
      if (sentences.length === VOCAB_DETAIL_MAX_USER_SENTENCES) {
        break;
      }
    }
    return sentences;
  }
}
