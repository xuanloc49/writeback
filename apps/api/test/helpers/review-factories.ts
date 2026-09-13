import { randomUUID } from 'node:crypto';
import type { Lemma, SrsCard, SrsStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { SRS, type ScoringOutput } from '@writeback/shared';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { TargetSnapshot } from '../../src/rewrite/rewrite.dto';

export interface CreateCardOptions {
  userId: string;
  lemmaId: string;
  status?: SrsStatus;
  ef?: number;
  repetitions?: number;
  intervalDays?: number;
  nextReviewAt: Date;
  hiddenAt?: Date | null;
  createdAt?: Date;
}

/** Inserts an `srs_cards` row directly (review-queue fixtures). */
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
      createdAt: options.createdAt ?? options.nextReviewAt,
    },
  });
}

export interface CreateScoredAttemptOptions {
  userId: string;
  promptId: string;
  topicId: string;
  targets: Pick<Lemma, 'id' | 'headword' | 'pos' | 'senseVi'>[];
  userEn: string;
  /** Headwords the (fake) LLM marked `used: true`; the rest are `used: false`. */
  usedHeadwords: string[];
  modelRewriteEn: string;
  scoredAt: Date;
  revision?: number;
}

/** Inserts a scored, charged attempt with a schema-valid `feedback` payload. */
export async function createScoredAttempt(
  prisma: PrismaService,
  options: CreateScoredAttemptOptions,
): Promise<string> {
  const id = randomUUID();
  const used = new Set(options.usedHeadwords.map((h) => h.toLowerCase()));
  const feedback: ScoringOutput = {
    overall_score: 70,
    idea_match: { status: 'enough', comment_vi: 'ok' },
    used_required_words: options.targets.map((target) => ({
      headword: target.headword,
      used: used.has(target.headword.toLowerCase()),
      natural: used.has(target.headword.toLowerCase()),
      comment_vi: 'ok',
    })),
    grammar_issues: [],
    lexical_issues: [],
    naturalness_note_vi: 'ok',
    model_rewrite_en: options.modelRewriteEn,
    encouragement_vi: 'ok',
  };
  const targets: TargetSnapshot[] = options.targets.map((target) => ({
    lemmaId: target.id,
    headword: target.headword,
    pos: target.pos,
    senseVi: target.senseVi,
  }));
  await prisma.rewriteAttempt.create({
    data: {
      id,
      attemptId: id,
      revision: options.revision ?? 1,
      userId: options.userId,
      promptId: options.promptId,
      status: 'scored',
      userEn: options.userEn,
      promptTextViSnapshot: 'vi',
      sampleEnSnapshot: 'SAMPLE SENTENCE MUST NEVER LEAK',
      targetsSnapshot: targets as unknown as Prisma.InputJsonArray,
      topicIdSnapshot: options.topicId,
      scoredAt: options.scoredAt,
      overallScore: feedback.overall_score,
      feedback: feedback as unknown as Prisma.InputJsonObject,
      quotaCharged: true,
    },
  });
  return id;
}
