import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type RewriteAttempt, type User } from '@prisma/client';
import {
  isCopyBlocked,
  LLM,
  pickDisplayIssues,
  REWRITE,
  scoringOutputSchema,
  validateUsedWordsOneToOne,
  type DisplayIssue,
  type ScoringOutput,
} from '@writeback/shared';
import { ActivityService } from '../activity/activity.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { VisibilityService, type PromptWithLemmas } from '../catalog/visibility.service';
import { AppError, appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import { AppConfig } from '../config/app-config';
import { CostEstimator } from '../llm/cost-estimator';
import {
  SCORING_PROVIDER,
  ScoringProviderError,
  type ScoringProvider,
  type ScoringResult,
} from '../llm/scoring-provider';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { describeQuotaReset, quotaExceededMessage, type QuotaScope } from '../quota/quota-reset';
import { QuotaService, type QuotaLeft } from '../quota/quota.service';
import { AutoAddService, type AutoAddResult } from '../vocab/auto-add.service';
import { PickerService, type PickerFilters } from './picker.service';
import type {
  AttemptFamilyResponse,
  PromptView,
  RevisionView,
  StartRewriteResponse,
  SubmitRewriteResponse,
  TargetSnapshot,
  UsedWordView,
} from './rewrite.dto';

const FIRST_REVISION = 1;
const SECOND_REVISION = REWRITE.MAX_REVISION;
const NO_CARDS: AutoAddResult = { cardsAdded: [], cardsDeferredCap20: [] };

/** Provider result whose `raw` payload has passed schema + one-to-one validation. */
type ValidatedScoring = Omit<ScoringResult, 'raw'> & { output: ScoringOutput };

@Injectable()
export class RewriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly picker: PickerService,
    private readonly quota: QuotaService,
    private readonly visibility: VisibilityService,
    private readonly autoAdd: AutoAddService,
    private readonly analytics: AnalyticsService,
    private readonly activity: ActivityService,
    private readonly cost: CostEstimator,
    private readonly config: AppConfig,
    @Inject(SCORING_PROVIDER) private readonly scoring: ScoringProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async start(
    user: User,
    filters: PickerFilters,
    requestId: string,
  ): Promise<StartRewriteResponse> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      await this.quota.lockUser(tx, user.id);
      const quota = await this.quota.remaining(tx, user, now);
      if (quota.rewriteNewLeft === 0) {
        await this.analytics.track(
          'rewrite_quota_blocked',
          user.id,
          { stage: 'start' },
          requestId,
          tx,
        );
        throw this.quotaExceeded(now, 'rewrite_new');
      }
      const prompt = await this.picker.pick(user, filters, now);
      const attemptId = randomUUID();
      const targets = targetsOf(prompt);
      await tx.rewriteAttempt.create({
        data: {
          id: attemptId,
          attemptId,
          revision: FIRST_REVISION,
          userId: user.id,
          promptId: prompt.id,
          status: 'started',
          promptTextViSnapshot: prompt.textVi,
          sampleEnSnapshot: prompt.sampleEn ?? '',
          targetsSnapshot: targets as unknown as Prisma.InputJsonArray,
          topicIdSnapshot: prompt.topicId,
          requestId,
        },
      });
      await this.analytics.track(
        'rewrite_started',
        user.id,
        { attempt_id: attemptId, topic_id: prompt.topicId, prompt_id: prompt.id },
        requestId,
        tx,
      );
      return {
        attemptId,
        revision: FIRST_REVISION,
        prompt: promptView(prompt, targets),
        quota,
        revisionUntil: null,
      };
    });
  }

  async submit(
    user: User,
    attemptId: string,
    revision: number,
    userEn: string,
    requestId: string,
  ): Promise<SubmitRewriteResponse> {
    const family = await this.loadFamily(user, attemptId);
    const rev1 = family.find((row) => row.revision === FIRST_REVISION);
    if (rev1 === undefined) {
      throw appError('NOT_FOUND');
    }

    const now = this.clock.now();
    const target = await this.resolveTargetRow(user, family, rev1, revision, now);

    if (target.status === 'scored' && target.quotaCharged) {
      return this.buildSubmitResponse(user, target, rev1, NO_CARDS, now);
    }

    await this.assertStillPublished(target);
    const references = [target.sampleEnSnapshot];
    if (revision === SECOND_REVISION) {
      const rev1Rewrite = feedbackOf(rev1)?.model_rewrite_en;
      if (rev1Rewrite !== undefined) {
        references.push(rev1Rewrite);
      }
    }
    if (isCopyBlocked(userEn, references)) {
      throw appError('COPY_BLOCKED');
    }

    const claimed = await this.claimForScoring(target.id, userEn, now);
    if (claimed.status === 'scored' && claimed.quotaCharged) {
      return this.buildSubmitResponse(user, claimed, rev1, NO_CARDS, now);
    }

    const output = await this.callProvider(claimed, requestId);
    return this.persistScored(user, claimed, rev1, output, requestId);
  }

  async family(user: User, attemptId: string): Promise<AttemptFamilyResponse> {
    const rows = await this.loadFamily(user, attemptId);
    const rev1 = rows.find((row) => row.revision === FIRST_REVISION);
    if (rev1 === undefined) {
      throw appError('NOT_FOUND');
    }
    const now = this.clock.now();
    const rev2 = rows.find((row) => row.revision === SECOND_REVISION);
    const quota = await this.prisma.$transaction((tx) => this.quota.remaining(tx, user, now));
    const revisionUntil = revisionDeadline(rev1);
    const rev2Scored = rev2 !== undefined && rev2.status === 'scored';
    return {
      attemptId: rev1.attemptId,
      prompt: await this.promptViewForAttempt(rev1),
      revisions: rows.map(revisionView),
      revisionAvailable:
        revisionUntil !== null && now <= revisionUntil && !rev2Scored && quota.retryLeft > 0,
      revisionUntil: revisionUntil?.toISOString() ?? null,
      showModelRewriteToggle:
        !rev2Scored &&
        rev1.overallScore !== null &&
        rev1.overallScore < REWRITE.MODEL_REWRITE_TOGGLE_BELOW_SCORE,
      quota,
    };
  }

  /** QUOTA_EXCEEDED with the reset instant derived from BUSINESS_TZ (design §5.2, PRD §8). */
  private quotaExceeded(now: Date, scope: QuotaScope): AppError {
    const { resetAt, label } = describeQuotaReset(now, this.config.businessTz);
    return new AppError('QUOTA_EXCEEDED', quotaExceededMessage(scope, label), {
      resetAt: resetAt.toISOString(),
      scope,
    });
  }

  private async loadFamily(user: User, attemptId: string): Promise<RewriteAttempt[]> {
    const rows = await this.prisma.rewriteAttempt.findMany({
      where: { attemptId, userId: user.id },
      orderBy: { revision: 'asc' },
    });
    if (rows.length === 0) {
      throw appError('NOT_FOUND');
    }
    return rows;
  }

  /** Returns the row for the requested revision, creating the rev-2 row when allowed (§9.2). */
  private async resolveTargetRow(
    user: User,
    family: RewriteAttempt[],
    rev1: RewriteAttempt,
    revision: number,
    now: Date,
  ): Promise<RewriteAttempt> {
    if (revision === FIRST_REVISION) {
      return rev1;
    }
    const existing = family.find((row) => row.revision === SECOND_REVISION);
    if (existing !== undefined && existing.status === 'scored' && existing.quotaCharged) {
      return existing;
    }
    const deadline = revisionDeadline(rev1);
    if (deadline === null || !rev1.quotaCharged) {
      throw appError('FORBIDDEN', { reason: 'revision_requires_scored_rev1' });
    }
    if (now > deadline) {
      throw appError('FORBIDDEN', { reason: 'revision_window_closed' });
    }
    return this.prisma.$transaction(async (tx) => {
      await this.quota.lockUser(tx, user.id);
      const quota = await this.quota.remaining(tx, user, now);
      if (quota.retryLeft === 0) {
        throw this.quotaExceeded(now, 'retry');
      }
      if (existing !== undefined) {
        return existing;
      }
      return tx.rewriteAttempt.create({
        data: {
          attemptId: rev1.attemptId,
          revision: SECOND_REVISION,
          parentAttemptId: rev1.id,
          userId: user.id,
          promptId: rev1.promptId,
          status: 'started',
          promptTextViSnapshot: rev1.promptTextViSnapshot,
          sampleEnSnapshot: rev1.sampleEnSnapshot,
          targetsSnapshot: rev1.targetsSnapshot as Prisma.InputJsonValue,
          topicIdSnapshot: rev1.topicIdSnapshot,
        },
      });
    });
  }

  private async assertStillPublished(attempt: RewriteAttempt): Promise<void> {
    const prompt = await this.prisma.prompt.findFirst({
      where: { id: attempt.promptId, deletedAt: null, status: 'published' },
      include: { lemmaLinks: { include: { lemma: true } } },
    });
    const targets = attempt.targetsSnapshot as unknown as TargetSnapshot[];
    const alive =
      prompt !== null &&
      targets.every((target) =>
        prompt.lemmaLinks.some(
          (link) =>
            link.lemmaId === target.lemmaId &&
            link.lemma.deletedAt === null &&
            link.lemma.status === 'published',
        ),
      );
    if (!alive) {
      throw appError('UNPUBLISHED');
    }
  }

  /** Idempotency (§5.4): lock the attempt row and move it to `scoring` unless already scored/in flight. */
  private async claimForScoring(rowId: string, userEn: string, now: Date): Promise<RewriteAttempt> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM rewrite_attempts WHERE id = ${rowId}::uuid FOR UPDATE`;
      const row = await tx.rewriteAttempt.findUniqueOrThrow({ where: { id: rowId } });
      if (row.status === 'scored' && row.quotaCharged) {
        return row;
      }
      const inFlight =
        row.status === 'scoring' &&
        now.getTime() - row.updatedAt.getTime() < LLM.SCORING_IN_PROGRESS_STALE_MS;
      if (inFlight) {
        throw appError('SCORING_IN_PROGRESS');
      }
      return tx.rewriteAttempt.update({
        where: { id: rowId },
        data: { status: 'scoring', userEn, failReason: null, updatedAt: now },
      });
    });
  }

  private async callProvider(
    attempt: RewriteAttempt,
    requestId: string,
  ): Promise<ValidatedScoring> {
    const targets = attempt.targetsSnapshot as unknown as TargetSnapshot[];
    let result: ScoringResult;
    try {
      result = await this.scoring.score({
        textVi: attempt.promptTextViSnapshot,
        requiredWords: targets.map((t) => ({
          headword: t.headword,
          pos: t.pos,
          senseVi: t.senseVi,
        })),
        sampleEn: attempt.sampleEnSnapshot,
        userEn: attempt.userEn ?? '',
      });
    } catch (error: unknown) {
      const reason = error instanceof ScoringProviderError ? error.reason : 'provider_5xx';
      await this.markFailed(attempt.id, reason, requestId);
      throw appError('LLM_TIMEOUT', { reason });
    }
    const parsed = scoringOutputSchema.safeParse(result.raw);
    if (!parsed.success) {
      await this.markFailed(attempt.id, 'invalid_schema', requestId);
      throw appError('LLM_INVALID_SCHEMA', { reason: 'schema' });
    }
    const oneToOne = validateUsedWordsOneToOne(
      parsed.data,
      targets.map((t) => t.headword),
    );
    if (!oneToOne.ok) {
      await this.markFailed(attempt.id, 'invalid_schema', requestId);
      throw appError('LLM_INVALID_SCHEMA', { reason: oneToOne.reason });
    }
    return {
      output: parsed.data,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
    };
  }

  private async markFailed(rowId: string, failReason: string, requestId: string): Promise<void> {
    await this.prisma.rewriteAttempt.update({
      where: { id: rowId },
      data: { status: 'failed', failReason, quotaCharged: false, requestId },
    });
  }

  private async persistScored(
    user: User,
    attempt: RewriteAttempt,
    rev1: RewriteAttempt,
    scored: ValidatedScoring,
    requestId: string,
  ): Promise<SubmitRewriteResponse> {
    const now = this.clock.now();
    const { output } = scored;
    return this.prisma.$transaction(async (tx) => {
      await this.quota.lockUser(tx, user.id);
      const updated = await tx.rewriteAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'scored',
          scoredAt: now,
          overallScore: output.overall_score,
          ideaMatchStatus: output.idea_match.status,
          ideaMatchCommentVi: output.idea_match.comment_vi,
          feedback: output as unknown as Prisma.InputJsonObject,
          displayIssues: pickDisplayIssues(output) as unknown as Prisma.InputJsonArray,
          model: scored.model,
          promptVersion: this.config.scoringPromptVersion,
          inputTokens: scored.inputTokens,
          outputTokens: scored.outputTokens,
          costEstimateUsd: new Prisma.Decimal(
            this.cost.estimateUsd(scored.inputTokens, scored.outputTokens),
          ),
          latencyMs: scored.latencyMs,
          requestId,
          quotaCharged: true,
          failReason: null,
        },
      });
      const cards = await this.autoAdd.apply(tx, user, updated, output, now);
      if (updated.revision === FIRST_REVISION) {
        await this.activity.recordRewriteNew(tx, user.id, now, requestId);
      }
      await this.analytics.track(
        'rewrite_scored',
        user.id,
        {
          attempt_id: updated.attemptId,
          revision: updated.revision,
          overall_score: output.overall_score,
          idea_match: output.idea_match.status,
          user_en_length: (updated.userEn ?? '').length,
          words_not_used_or_unnatural: output.used_required_words.filter(
            (w) => !w.used || !w.natural,
          ).length,
        },
        requestId,
        tx,
      );
      await this.cost.checkDailyBudget(now, tx);
      const effectiveRev1 = updated.revision === FIRST_REVISION ? updated : rev1;
      return this.buildSubmitResponse(user, updated, effectiveRev1, cards, now, tx);
    });
  }

  private async buildSubmitResponse(
    user: User,
    row: RewriteAttempt,
    rev1: RewriteAttempt,
    cards: AutoAddResult,
    now: Date,
    tx?: Tx,
  ): Promise<SubmitRewriteResponse> {
    const quota: QuotaLeft =
      tx !== undefined
        ? await this.quota.remaining(tx, user, now)
        : await this.prisma.$transaction((t) => this.quota.remaining(t, user, now));
    const output = feedbackOf(row);
    if (output === null || row.scoredAt === null) {
      throw appError('INTERNAL');
    }
    const isRev1 = row.revision === FIRST_REVISION;
    const revisionUntil = isRev1 ? revisionDeadline(rev1) : null;
    return {
      attemptId: row.attemptId,
      revision: row.revision,
      scoredAt: row.scoredAt.toISOString(),
      overallScore: output.overall_score,
      ideaMatch: { status: output.idea_match.status, commentVi: output.idea_match.comment_vi },
      usedRequiredWords: usedWordsView(output),
      displayIssues: displayIssuesOf(row),
      naturalnessNoteVi: output.naturalness_note_vi,
      encouragementVi: output.encouragement_vi,
      modelRewriteEn: output.model_rewrite_en,
      showModelRewriteToggle: false,
      revisionUntil: revisionUntil?.toISOString() ?? null,
      revisionAvailable:
        isRev1 && revisionUntil !== null && now <= revisionUntil && quota.retryLeft > 0,
      cardsAdded: cards.cardsAdded,
      cardsDeferredCap20: cards.cardsDeferredCap20,
      quota,
    };
  }

  private async promptViewForAttempt(rev1: RewriteAttempt): Promise<PromptView> {
    const prompt = await this.prisma.prompt.findUnique({
      where: { id: rev1.promptId },
      include: { topic: { select: { nameVi: true } } },
    });
    return {
      id: rev1.promptId,
      textVi: rev1.promptTextViSnapshot,
      hintsVi: prompt?.hintsVi ?? null,
      topicId: rev1.topicIdSnapshot,
      topicNameVi: prompt?.topic.nameVi ?? '',
      targets: rev1.targetsSnapshot as unknown as TargetSnapshot[],
    };
  }
}

function targetsOf(prompt: PromptWithLemmas): TargetSnapshot[] {
  return prompt.lemmaLinks.map((link) => ({
    lemmaId: link.lemma.id,
    headword: link.lemma.headword,
    pos: link.lemma.pos,
    senseVi: link.lemma.senseVi,
  }));
}

function promptView(prompt: PromptWithLemmas, targets: TargetSnapshot[]): PromptView {
  return {
    id: prompt.id,
    textVi: prompt.textVi,
    hintsVi: prompt.hintsVi,
    topicId: prompt.topicId,
    topicNameVi: prompt.topic.nameVi,
    targets,
  };
}

function feedbackOf(row: RewriteAttempt): ScoringOutput | null {
  if (row.feedback === null) {
    return null;
  }
  const parsed = scoringOutputSchema.safeParse(row.feedback);
  return parsed.success ? parsed.data : null;
}

function displayIssuesOf(row: RewriteAttempt): DisplayIssue[] {
  return Array.isArray(row.displayIssues) ? (row.displayIssues as unknown as DisplayIssue[]) : [];
}

function usedWordsView(output: ScoringOutput): UsedWordView[] {
  return output.used_required_words.map((w) => ({
    headword: w.headword,
    used: w.used,
    natural: w.natural,
    commentVi: w.comment_vi,
  }));
}

function revisionDeadline(rev1: RewriteAttempt): Date | null {
  if (rev1.scoredAt === null || !rev1.quotaCharged) {
    return null;
  }
  return new Date(rev1.scoredAt.getTime() + REWRITE.REVISION_WINDOW_MS);
}

function revisionView(row: RewriteAttempt): RevisionView {
  const output = feedbackOf(row);
  return {
    revision: row.revision,
    status: row.status,
    userEn: row.userEn,
    scoredAt: row.scoredAt?.toISOString() ?? null,
    overallScore: row.overallScore,
    ideaMatch:
      output === null
        ? null
        : { status: output.idea_match.status, commentVi: output.idea_match.comment_vi },
    usedRequiredWords: output === null ? [] : usedWordsView(output),
    displayIssues: displayIssuesOf(row),
    naturalnessNoteVi: output?.naturalness_note_vi ?? null,
    encouragementVi: output?.encouragement_vi ?? null,
    modelRewriteEn: output?.model_rewrite_en ?? null,
  };
}
