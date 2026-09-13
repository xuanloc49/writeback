import { Inject, Injectable } from '@nestjs/common';
import type { ReviewSession, User } from '@prisma/client';
import {
  inflectionSet,
  matchReviewAnswer,
  nextSm2,
  qualityForTypedAnswer,
  type ReviewMode,
  type ReviewQuality,
  type Sm2CardState,
} from '@writeback/shared';
import { ActivityService } from '../activity/activity.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { PlanLimitsService } from '../catalog/plan-limits.service';
import { appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ClozeSourceService, selectClozeSource } from './cloze-source.service';
import { ReviewQueueService, type QueueCard } from './review-queue.service';
import type {
  CardView,
  FlashcardBack,
  GradeBody,
  GradeResponse,
  NextResponse,
  RevealView,
  StartSessionResponse,
} from './review.dto';

/** Everything the server derives for one card: the client view plus the private answer set. */
interface Presentation {
  view: CardView;
  reveal: RevealView;
  /** headword ∪ inflectionSet ∪ blanked surfaces (cloze) — PRD §10.6. */
  accepted: Set<string>;
}

/** Design §10 / §12.4 review sessions. */
@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitsService,
    private readonly queue: ReviewQueueService,
    private readonly cloze: ClozeSourceService,
    private readonly activity: ActivityService,
    private readonly analytics: AnalyticsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async startSession(user: User, requestId: string): Promise<StartSessionResponse> {
    const now = this.clock.now();
    const limits = await this.planLimits.forUser(user);
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.reviewSession.create({
        data: { userId: user.id, cap: limits.reviewSessionCap, startedAt: now },
      });
      const due = await this.queue.dueCards(tx, user.id, now);
      await this.analytics.track(
        'review_session_started',
        user.id,
        { session_id: session.id, cap: session.cap, due_count: due.length },
        requestId,
        tx,
      );
      return {
        sessionId: session.id,
        cap: session.cap,
        remaining: Math.min(session.cap, due.length),
      };
    });
  }

  async next(user: User, sessionId: string): Promise<NextResponse> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const session = await this.loadOpenSession(tx, user, sessionId);
      return this.nextFor(tx, user.id, session, now);
    });
  }

  async grade(
    user: User,
    sessionId: string,
    body: GradeBody,
    requestId: string,
  ): Promise<GradeResponse> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      // Serialize grades of one session so `graded_count` can never overshoot `cap`.
      await tx.$executeRaw`SELECT id FROM review_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      const session = await this.loadOpenSession(tx, user, sessionId);
      const graded = await this.queue.gradedCardIds(tx, session.id);
      const queue = await this.queue.dueCards(tx, user.id, now, graded);
      const card = queue.find((candidate) => candidate.id === body.cardId);
      if (card === undefined) {
        throw appError('NOT_FOUND');
      }
      const presentation = await this.present(tx, user.id, card);
      const { quality, correct } = resolveQuality(presentation, body);
      const sm2 = nextSm2(sm2StateOf(card), quality, now);

      await tx.srsCard.update({
        where: { id: card.id },
        data: {
          status: sm2.status,
          ef: sm2.ef,
          repetitions: sm2.repetitions,
          intervalDays: sm2.intervalDays,
          nextReviewAt: sm2.nextReviewAt,
        },
      });
      const mode = presentation.view.mode;
      await tx.srsReview.create({
        data: { cardId: card.id, sessionId: session.id, mode, quality, createdAt: now },
      });
      const gradedCount = session.gradedCount + 1;
      const updatedSession = await tx.reviewSession.update({
        where: { id: session.id },
        data: { gradedCount, ...(gradedCount >= session.cap ? { endedAt: now } : {}) },
      });
      await this.activity.recordReview(tx, user.id, now, requestId);
      await this.analytics.track(
        'review_graded',
        user.id,
        {
          session_id: session.id,
          card_id: card.id,
          lemma_id: card.lemmaId,
          mode,
          quality,
          correct: correct ?? null,
        },
        requestId,
        tx,
      );

      const next = await this.nextFor(tx, user.id, updatedSession, now);
      return {
        quality,
        ...(correct === undefined ? {} : { correct }),
        mode,
        card: {
          status: sm2.status,
          nextReviewAt: sm2.nextReviewAt.toISOString(),
          intervalDays: sm2.intervalDays,
        },
        ...(mode === 'flashcard' ? {} : { reveal: presentation.reveal }),
        next,
      };
    });
  }

  /** Session of this user that is still open; other owner / unknown → NOT_FOUND, ended → FORBIDDEN. */
  private async loadOpenSession(tx: Tx, user: User, sessionId: string): Promise<ReviewSession> {
    const session = await tx.reviewSession.findFirst({ where: { id: sessionId, userId: user.id } });
    if (session === null) {
      throw appError('NOT_FOUND');
    }
    if (session.endedAt !== null) {
      throw appError('FORBIDDEN', { reason: 'session_ended' });
    }
    return session;
  }

  private async nextFor(
    tx: Tx,
    userId: string,
    session: ReviewSession,
    now: Date,
  ): Promise<NextResponse> {
    if (session.gradedCount >= session.cap) {
      return { done: true, reason: 'cap' };
    }
    const graded = await this.queue.gradedCardIds(tx, session.id);
    const queue = await this.queue.dueCards(tx, userId, now, graded);
    const card = queue[0];
    if (card === undefined) {
      return { done: true, reason: 'empty' };
    }
    const presentation = await this.present(tx, userId, card);
    return {
      done: false,
      card: presentation.view,
      remaining: Math.min(queue.length, session.cap - session.gradedCount),
    };
  }

  /**
   * Mode selection (design §10): `new` → flashcard; anything else → cloze when a usable source
   * sentence exists, else type. Deterministic for a given DB state, so `grade` recomputes it.
   */
  private async present(tx: Tx, userId: string, card: QueueCard): Promise<Presentation> {
    const { lemma } = card;
    const sources = await this.cloze.sourcesFor(tx, userId, lemma);
    const exampleSentence = sources.usedSentence ?? lemma.exampleEn;
    const reveal: RevealView = { headword: lemma.headword, exampleSentence };
    const accepted = new Set<string>([lemma.headword, ...inflectionSet(lemma.headword)]);
    const base = { cardId: card.id, lemmaId: lemma.id };

    if (card.status === 'new') {
      const back: FlashcardBack = {
        headword: lemma.headword,
        phonetic: lemma.phonetic,
        notesVi: lemma.notesVi,
        exampleSentence,
      };
      return {
        view: {
          ...base,
          mode: 'flashcard',
          front: { senseVi: lemma.senseVi, topicNameVi: lemma.topic.nameVi },
          back,
        },
        reveal,
        accepted,
      };
    }

    const source = selectClozeSource(sources, lemma.headword);
    if (source === null) {
      return {
        view: { ...base, mode: 'type', front: { senseVi: lemma.senseVi } },
        reveal,
        accepted,
      };
    }
    for (const surface of source.blanked) {
      accepted.add(surface);
    }
    return {
      view: { ...base, mode: 'cloze', front: { senseVi: lemma.senseVi, sentence: source.text } },
      reveal,
      accepted,
    };
  }
}

function sm2StateOf(card: QueueCard): Sm2CardState {
  return {
    status: card.status,
    ef: card.ef,
    repetitions: card.repetitions,
    intervalDays: card.intervalDays,
    nextReviewAt: card.nextReviewAt,
  };
}

/** Body must match the server-chosen mode; typed answers are matched with `matchReviewAnswer`. */
function resolveQuality(
  presentation: Presentation,
  body: GradeBody,
): { quality: ReviewQuality; correct?: boolean } {
  const mode: ReviewMode = presentation.view.mode;
  if ('quality' in body) {
    if (mode !== 'flashcard') {
      throw appError('VALIDATION', { expectedMode: mode, reason: 'answer_required' });
    }
    return { quality: body.quality };
  }
  if (mode === 'flashcard') {
    throw appError('VALIDATION', { expectedMode: mode, reason: 'quality_required' });
  }
  const correct = matchReviewAnswer(body.answer, presentation.accepted);
  return { quality: qualityForTypedAnswer(correct), correct };
}
