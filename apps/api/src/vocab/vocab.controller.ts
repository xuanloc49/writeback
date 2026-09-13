import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { LearningGateGuard } from '../auth/learning-gate.guard';
import { SessionGuard } from '../auth/session.guard';
import { appError } from '../common/app-error';
import { VocabService, type UndoAutoAddResult } from './vocab.service';

@Controller('vocab')
@UseGuards(SessionGuard, LearningGateGuard)
export class VocabController {
  constructor(private readonly vocab: VocabService) {}

  /** PRD §10.5: no manual add. */
  @Post()
  addManually(): never {
    return this.vocab.addManually();
  }

  @Post('cards/:cardId/undo-auto-add')
  undoAutoAdd(
    @CurrentUser() user: User,
    @Param('cardId', new ParseUUIDPipe({ exceptionFactory: () => appError('NOT_FOUND') }))
    cardId: string,
  ): Promise<UndoAutoAddResult> {
    return this.vocab.undoAutoAdd(user, cardId);
  }
}
