import { Injectable } from '@nestjs/common';
import type { RewriteAttempt, User } from '@prisma/client';
import { businessDayRange, newSm2Card, type ScoringOutput } from '@writeback/shared';
import { PlanLimitsService } from '../catalog/plan-limits.service';
import { VisibilityService } from '../catalog/visibility.service';
import { AppConfig } from '../config/app-config';
import type { Tx } from '../prisma/prisma.service';
import type { CardAddedView, CardDeferredView, TargetSnapshot } from '../rewrite/rewrite.dto';

export interface AutoAddResult {
  cardsAdded: CardAddedView[];
  cardsDeferredCap20: CardDeferredView[];
}

/** Design §9.4 auto-add after a valid scored attempt; runs inside the caller's transaction. */
@Injectable()
export class AutoAddService {
  constructor(
    private readonly visibility: VisibilityService,
    private readonly planLimits: PlanLimitsService,
    private readonly config: AppConfig,
  ) {}

  async apply(
    tx: Tx,
    user: User,
    attempt: RewriteAttempt,
    output: ScoringOutput,
    now: Date,
  ): Promise<AutoAddResult> {
    const targets = attempt.targetsSnapshot as unknown as TargetSnapshot[];
    const limits = await this.planLimits.forUser(user, tx);
    const overrides = await this.visibility.overrides(user.id);
    const usedNaturalByHeadword = new Map(
      output.used_required_words.map((w) => [w.headword.toLowerCase(), w.used && w.natural]),
    );
    const { start, end } = businessDayRange(now, this.config.businessTz);
    let countedToday = await tx.srsCard.count({
      where: {
        userId: user.id,
        countedTowardDailyNew: true,
        hiddenAt: null,
        createdAt: { gte: start, lt: end },
      },
    });

    const result: AutoAddResult = { cardsAdded: [], cardsDeferredCap20: [] };
    for (const target of targets) {
      const lemma = await tx.lemma.findUnique({
        where: { id: target.lemmaId },
        include: { topic: { select: { status: true, deletedAt: true } } },
      });
      if (lemma === null || !this.visibility.isLemmaVisibleWith(user, lemma, lemma.topic, overrides)) {
        continue;
      }
      const existing = await tx.srsCard.findUnique({
        where: { userId_lemmaId: { userId: user.id, lemmaId: lemma.id } },
      });
      if (existing !== null) {
        continue;
      }
      const usedNatural = usedNaturalByHeadword.get(target.headword.toLowerCase()) ?? false;
      const cap = limits.newCardsUsedNaturalPerDay;
      if (usedNatural && cap !== null && countedToday >= cap) {
        result.cardsDeferredCap20.push({ lemmaId: lemma.id, headword: lemma.headword });
        continue;
      }
      const sm2 = newSm2Card(now);
      const card = await tx.srsCard.create({
        data: {
          userId: user.id,
          lemmaId: lemma.id,
          status: sm2.status,
          ef: sm2.ef,
          repetitions: sm2.repetitions,
          intervalDays: sm2.intervalDays,
          nextReviewAt: sm2.nextReviewAt,
          countedTowardDailyNew: usedNatural,
          addedFromAttemptId: attempt.id,
          addedRevision: attempt.revision,
          createdAt: now,
        },
      });
      if (usedNatural) {
        countedToday += 1;
      }
      result.cardsAdded.push({
        cardId: card.id,
        lemmaId: lemma.id,
        headword: lemma.headword,
        undoable: usedNatural,
      });
    }
    return result;
  }
}
