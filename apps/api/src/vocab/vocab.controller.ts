import { Controller, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { LearningGateGuard } from '../auth/learning-gate.guard';
import { SessionGuard } from '../auth/session.guard';
import { appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';

@Controller('vocab')
@UseGuards(SessionGuard, LearningGateGuard)
export class VocabController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** PRD §10.5: no manual add. */
  @Post()
  addManually(): never {
    throw appError('FORBIDDEN', { reason: 'manual_add_disabled' });
  }

  @Post('cards/:cardId/undo-auto-add')
  async undoAutoAdd(
    @CurrentUser() user: User,
    @Param('cardId', new ParseUUIDPipe({ exceptionFactory: () => appError('NOT_FOUND') }))
    cardId: string,
  ): Promise<{ cardId: string; hiddenAt: string }> {
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
