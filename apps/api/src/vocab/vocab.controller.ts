import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { CurrentUser, RequestId } from '../auth/current-user.decorator';
import { LearningGateGuard } from '../auth/learning-gate.guard';
import { SessionGuard } from '../auth/session.guard';
import { appError } from '../common/app-error';
import type {
  HideCardResult,
  UnhideCardResult,
  VocabDetailResponse,
  VocabListResponse,
} from './vocab.dto';
import { VocabService, type UndoAutoAddResult } from './vocab.service';

/** Malformed ids are indistinguishable from unknown ones (hide existence). */
const idPipe = new ParseUUIDPipe({ exceptionFactory: () => appError('NOT_FOUND') });

@Controller('vocab')
@UseGuards(SessionGuard, LearningGateGuard)
export class VocabController {
  constructor(private readonly vocab: VocabService) {}

  @Get()
  list(@CurrentUser() user: User): Promise<VocabListResponse> {
    return this.vocab.list(user);
  }

  @Get(':lemmaId')
  detail(
    @CurrentUser() user: User,
    @Param('lemmaId', idPipe) lemmaId: string,
  ): Promise<VocabDetailResponse> {
    return this.vocab.detail(user, lemmaId);
  }

  /** PRD §10.5: no manual add. */
  @Post()
  addManually(): never {
    return this.vocab.addManually();
  }

  @Post(':lemmaId/hide')
  @HttpCode(HttpStatus.OK)
  hide(
    @CurrentUser() user: User,
    @Param('lemmaId', idPipe) lemmaId: string,
  ): Promise<HideCardResult> {
    return this.vocab.hide(user, lemmaId);
  }

  @Post(':lemmaId/unhide')
  @HttpCode(HttpStatus.OK)
  unhide(
    @CurrentUser() user: User,
    @Param('lemmaId', idPipe) lemmaId: string,
    @RequestId() requestId: string,
  ): Promise<UnhideCardResult> {
    return this.vocab.unhide(user, lemmaId, requestId);
  }

  @Post('cards/:cardId/undo-auto-add')
  @HttpCode(HttpStatus.OK)
  undoAutoAdd(
    @CurrentUser() user: User,
    @Param('cardId', idPipe) cardId: string,
  ): Promise<UndoAutoAddResult> {
    return this.vocab.undoAutoAdd(user, cardId);
  }
}
