import { Inject, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { isDueToday, PICKER, type ScoringOutput } from '@writeback/shared';
import { VisibilityService, type PromptWithLemmas } from '../catalog/visibility.service';
import { appError } from '../common/app-error';
import { RANDOM, type Random } from '../common/random';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';

export interface PickerFilters {
  topicId?: string;
  lemmaId?: string;
}

/** Signals needed to rank a candidate prompt (design §8.2). */
export interface PickerSignals {
  dueOrLearningLemmaIds: Set<string>;
  recentMisuseLemmaIds: Set<string>;
  onboardingTopicIds: Set<string>;
  scoredPromptIds: Set<string>;
}

const MS_PER_DAY = 86_400_000;

@Injectable()
export class PickerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: VisibilityService,
    private readonly config: AppConfig,
    @Inject(RANDOM) private readonly random: Random,
  ) {}

  async pick(user: User, filters: PickerFilters, now: Date): Promise<PromptWithLemmas> {
    const candidates = await this.visibility.visiblePromptCandidates(user, filters);
    if (candidates.length === 0) {
      throw appError('NO_PROMPT');
    }
    const lastScoredByPrompt = await this.lastScoredByPrompt(user.id, candidates);
    const pool = applyNoRepeat(candidates, lastScoredByPrompt, now);
    const signals = await this.loadSignals(user, pool, now);
    return chooseFromTop(rankCandidates(pool, signals), this.random);
  }

  private async lastScoredByPrompt(
    userId: string,
    candidates: PromptWithLemmas[],
  ): Promise<Map<string, Date>> {
    const rows = await this.prisma.rewriteAttempt.groupBy({
      by: ['promptId'],
      where: {
        userId,
        quotaCharged: true,
        promptId: { in: candidates.map((prompt) => prompt.id) },
      },
      _max: { scoredAt: true },
    });
    const result = new Map<string, Date>();
    for (const row of rows) {
      if (row._max.scoredAt !== null) {
        result.set(row.promptId, row._max.scoredAt);
      }
    }
    return result;
  }

  private async loadSignals(
    user: User,
    pool: PromptWithLemmas[],
    now: Date,
  ): Promise<PickerSignals> {
    const lemmaIds = [
      ...new Set(pool.flatMap((prompt) => prompt.lemmaLinks.map((l) => l.lemmaId))),
    ];
    const misuseSince = new Date(now.getTime() - PICKER.MISUSE_LOOKBACK_DAYS * MS_PER_DAY);
    const [cards, onboarding, scored, recentAttempts] = await Promise.all([
      this.prisma.srsCard.findMany({
        where: { userId: user.id, hiddenAt: null, lemmaId: { in: lemmaIds } },
        select: { lemmaId: true, status: true, nextReviewAt: true },
      }),
      this.prisma.userOnboardingTopic.findMany({
        where: { userId: user.id },
        select: { topicId: true },
      }),
      this.prisma.rewriteAttempt.findMany({
        where: { userId: user.id, quotaCharged: true, promptId: { in: pool.map((p) => p.id) } },
        select: { promptId: true },
        distinct: ['promptId'],
      }),
      this.prisma.rewriteAttempt.findMany({
        where: { userId: user.id, quotaCharged: true, scoredAt: { gte: misuseSince } },
        select: { feedback: true, targetsSnapshot: true },
      }),
    ]);
    const dueOrLearningLemmaIds = new Set(
      cards
        .filter(
          (card) =>
            card.status === 'learning' ||
            isDueToday(card.nextReviewAt, now, this.config.businessTz),
        )
        .map((card) => card.lemmaId),
    );
    return {
      dueOrLearningLemmaIds,
      recentMisuseLemmaIds: collectMisusedLemmaIds(recentAttempts),
      onboardingTopicIds: new Set(onboarding.map((row) => row.topicId)),
      scoredPromptIds: new Set(scored.map((row) => row.promptId)),
    };
  }
}

interface TargetSnapshot {
  lemmaId: string;
  headword: string;
}

function collectMisusedLemmaIds(
  attempts: { feedback: unknown; targetsSnapshot: unknown }[],
): Set<string> {
  const result = new Set<string>();
  for (const attempt of attempts) {
    const feedback = attempt.feedback as Pick<ScoringOutput, 'used_required_words'> | null;
    const targets = attempt.targetsSnapshot as TargetSnapshot[] | null;
    if (
      feedback === null ||
      !Array.isArray(feedback.used_required_words) ||
      !Array.isArray(targets)
    ) {
      continue;
    }
    const byHeadword = new Map(targets.map((t) => [t.headword.toLowerCase(), t.lemmaId]));
    for (const word of feedback.used_required_words) {
      if (!word.used || !word.natural) {
        const lemmaId = byHeadword.get(word.headword.toLowerCase());
        if (lemmaId !== undefined) {
          result.add(lemmaId);
        }
      }
    }
  }
  return result;
}

/** Excludes prompts scored within NO_REPEAT_DAYS unless that empties the pool (then oldest first). */
export function applyNoRepeat(
  candidates: PromptWithLemmas[],
  lastScored: Map<string, Date>,
  now: Date,
): PromptWithLemmas[] {
  const cutoff = now.getTime() - PICKER.NO_REPEAT_DAYS * MS_PER_DAY;
  const fresh = candidates.filter((prompt) => {
    const last = lastScored.get(prompt.id);
    return last === undefined || last.getTime() < cutoff;
  });
  if (fresh.length > 0) {
    return fresh;
  }
  const oldest = [...candidates].sort(
    (a, b) => (lastScored.get(a.id)?.getTime() ?? 0) - (lastScored.get(b.id)?.getTime() ?? 0),
  );
  return oldest.slice(0, 1);
}

export function scorePrompt(prompt: PromptWithLemmas, signals: PickerSignals): number {
  let score = 0;
  for (const link of prompt.lemmaLinks) {
    if (signals.dueOrLearningLemmaIds.has(link.lemmaId)) {
      score += PICKER.WEIGHT_DUE_OR_LEARNING;
    }
    if (signals.recentMisuseLemmaIds.has(link.lemmaId)) {
      score += PICKER.WEIGHT_RECENT_MISUSE;
    }
  }
  if (signals.onboardingTopicIds.has(prompt.topicId)) {
    score += PICKER.WEIGHT_ONBOARDING_TOPIC;
  }
  if (!signals.scoredPromptIds.has(prompt.id)) {
    score += PICKER.WEIGHT_NEVER_DONE;
  }
  return score;
}

/** Ranks by score desc with a stable id tiebreak; returns the top N. */
export function rankCandidates(
  pool: PromptWithLemmas[],
  signals: PickerSignals,
): PromptWithLemmas[] {
  return pool
    .map((prompt) => ({ prompt, score: scorePrompt(prompt, signals) }))
    .sort((a, b) => b.score - a.score || a.prompt.id.localeCompare(b.prompt.id))
    .slice(0, PICKER.TOP_N)
    .map((entry) => entry.prompt);
}

export function chooseFromTop(top: PromptWithLemmas[], random: Random): PromptWithLemmas {
  const index = Math.min(top.length - 1, Math.floor(random.next() * top.length));
  const chosen = top[index];
  if (chosen === undefined) {
    throw appError('NO_PROMPT');
  }
  return chosen;
}
