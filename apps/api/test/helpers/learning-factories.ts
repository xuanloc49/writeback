import { randomUUID } from 'node:crypto';
import type { ReviewMode, RewriteAttempt, SrsCard, SrsReview, SrsStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { SRS, type ScoringOutput } from '@writeback/shared';
import type { PrismaService } from '../../src/prisma/prisma.service';

/** Factories for learning-side rows (cards, reviews, scored attempts). Never edits factories.ts. */

export interface CreateCardOptions {
  userId: string;
  lemmaId: string;
  status?: SrsStatus;
  nextReviewAt: Date;
  hiddenAt?: Date | null;
  ef?: number;
  repetitions?: number;
  intervalDays?: number;
  countedTowardDailyNew?: boolean;
  addedFromAttemptId?: string | null;
  createdAt?: Date;
}

export async function createCard(
  prisma: PrismaService,
  options: CreateCardOptions,
): Promise<SrsCard> {
  return prisma.srsCard.create({
    data: {
      userId: options.userId,
      lemmaId: options.lemmaId,
      status: options.status ?? 'new',
      ef: options.ef ?? SRS.INITIAL_EF,
      repetitions: options.repetitions ?? 0,
      intervalDays: options.intervalDays ?? 0,
      nextReviewAt: options.nextReviewAt,
      hiddenAt: options.hiddenAt ?? null,
      countedTowardDailyNew: options.countedTowardDailyNew ?? false,
      addedFromAttemptId: options.addedFromAttemptId ?? null,
      addedRevision: options.addedFromAttemptId ? 1 : null,
      ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
    },
  });
}

export interface CreateReviewOptions {
  userId: string;
  cardId: string;
  createdAt: Date;
  quality?: number;
  mode?: ReviewMode;
  cap?: number;
}

/** Creates a one-review session for `userId` and a graded review row on `cardId`. */
export async function createReview(
  prisma: PrismaService,
  options: CreateReviewOptions,
): Promise<SrsReview> {
  const session = await prisma.reviewSession.create({
    data: {
      userId: options.userId,
      cap: options.cap ?? 20,
      gradedCount: 1,
      startedAt: options.createdAt,
    },
  });
  return prisma.srsReview.create({
    data: {
      cardId: options.cardId,
      sessionId: session.id,
      mode: options.mode ?? 'flashcard',
      quality: options.quality ?? 4,
      createdAt: options.createdAt,
    },
  });
}

export interface UsedWordSpec {
  headword: string;
  used: boolean;
  natural?: boolean;
}

export interface CreateScoredAttemptOptions {
  userId: string;
  promptId: string;
  topicId: string;
  scoredAt: Date;
  userEn: string;
  targets: { lemmaId: string; headword: string; senseVi?: string }[];
  usedWords?: UsedWordSpec[];
  overallScore?: number;
  revision?: number;
  /** Family id; required for revision 2 (same value as the rev-1 row). */
  attemptId?: string;
  parentAttemptId?: string | null;
  createdAt?: Date;
  quotaCharged?: boolean;
}

/** A valid ScoringOutput so `GET /rewrite/:id` and vocab detail can parse `feedback`. */
export function buildFeedback(
  targets: { headword: string }[],
  usedWords: UsedWordSpec[] | undefined,
  overallScore: number,
): ScoringOutput {
  const specByHeadword = new Map((usedWords ?? []).map((w) => [w.headword.toLowerCase(), w]));
  return {
    overall_score: overallScore,
    idea_match: { status: 'enough', comment_vi: 'Đủ ý.' },
    used_required_words: targets.map((target) => {
      const spec = specByHeadword.get(target.headword.toLowerCase());
      const used = spec?.used ?? true;
      return {
        headword: target.headword,
        used,
        natural: spec?.natural ?? used,
        comment_vi: used ? 'Dùng đúng.' : 'Chưa dùng.',
      };
    }),
    grammar_issues: [],
    lexical_issues: [],
    naturalness_note_vi: 'Ổn.',
    model_rewrite_en: 'Model rewrite.',
    encouragement_vi: 'Tốt!',
  };
}

/** Inserts a scored (charged by default) attempt row with parsable feedback. */
export async function createScoredAttempt(
  prisma: PrismaService,
  options: CreateScoredAttemptOptions,
): Promise<RewriteAttempt> {
  const revision = options.revision ?? 1;
  const id = randomUUID();
  const attemptId = options.attemptId ?? id;
  const overallScore = options.overallScore ?? 70;
  const feedback = buildFeedback(options.targets, options.usedWords, overallScore);
  return prisma.rewriteAttempt.create({
    data: {
      id,
      attemptId,
      revision,
      parentAttemptId: options.parentAttemptId ?? null,
      userId: options.userId,
      promptId: options.promptId,
      status: 'scored',
      userEn: options.userEn,
      promptTextViSnapshot: 'Câu tiếng Việt.',
      sampleEnSnapshot: 'Sample sentence snapshot that must never leak.',
      targetsSnapshot: options.targets.map((target) => ({
        lemmaId: target.lemmaId,
        headword: target.headword,
        pos: 'noun',
        senseVi: target.senseVi ?? `nghĩa của ${target.headword}`,
      })) as unknown as Prisma.InputJsonArray,
      topicIdSnapshot: options.topicId,
      scoredAt: options.scoredAt,
      overallScore,
      ideaMatchStatus: 'enough',
      ideaMatchCommentVi: feedback.idea_match.comment_vi,
      feedback: feedback as unknown as Prisma.InputJsonObject,
      displayIssues: [] as unknown as Prisma.InputJsonArray,
      quotaCharged: options.quotaCharged ?? true,
      createdAt: options.createdAt ?? options.scoredAt,
    },
  });
}
