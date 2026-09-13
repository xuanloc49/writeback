import { Inject, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';

export interface UndoAutoAddResult {
  cardId: string;
  hiddenAt: string;
}

@Injectable()
export class VocabService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** PRD §10.5: no manual add. */
  addManually(): never {
    throw appError('FORBIDDEN', { reason: 'manual_add_disabled' });
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
}
