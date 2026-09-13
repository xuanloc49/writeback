import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { LearningGateGuard } from '../auth/learning-gate.guard';
import { SessionGuard } from '../auth/session.guard';
import { appError } from '../common/app-error';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AttemptFamilyResponse } from '../rewrite/rewrite.dto';
import { historyQuerySchema, type HistoryListResponse, type HistoryQuery } from './history.dto';
import { HistoryService } from './history.service';

const attemptIdPipe = new ParseUUIDPipe({ exceptionFactory: () => appError('NOT_FOUND') });

@Controller('history')
@UseGuards(SessionGuard, LearningGateGuard)
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get()
  list(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(historyQuerySchema)) query: HistoryQuery,
  ): Promise<HistoryListResponse> {
    return this.history.list(user, query.cursor, query.limit);
  }

  @Get(':attemptId')
  detail(
    @CurrentUser() user: User,
    @Param('attemptId', attemptIdPipe) attemptId: string,
  ): Promise<AttemptFamilyResponse> {
    return this.history.detail(user, attemptId);
  }
}
