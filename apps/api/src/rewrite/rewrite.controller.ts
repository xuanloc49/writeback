import {
  Body,
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
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  startRewriteSchema,
  submitRewriteSchema,
  type AttemptFamilyResponse,
  type StartRewriteBody,
  type StartRewriteResponse,
  type SubmitRewriteBody,
  type SubmitRewriteResponse,
} from './rewrite.dto';
import { RewriteService } from './rewrite.service';

const attemptIdPipe = new ParseUUIDPipe({ exceptionFactory: () => appError('NOT_FOUND') });

@Controller('rewrite')
@UseGuards(SessionGuard, LearningGateGuard, RateLimitGuard)
export class RewriteController {
  constructor(private readonly rewrite: RewriteService) {}

  @Post('start')
  @HttpCode(HttpStatus.OK)
  @RateLimit('start')
  start(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(startRewriteSchema)) body: StartRewriteBody,
    @RequestId() requestId: string,
  ): Promise<StartRewriteResponse> {
    return this.rewrite.start(user, body, requestId);
  }

  @Post(':attemptId/submit')
  @HttpCode(HttpStatus.OK)
  @RateLimit('submit')
  submit(
    @CurrentUser() user: User,
    @Param('attemptId', attemptIdPipe) attemptId: string,
    @Body(new ZodValidationPipe(submitRewriteSchema)) body: SubmitRewriteBody,
    @RequestId() requestId: string,
  ): Promise<SubmitRewriteResponse> {
    return this.rewrite.submit(user, attemptId, body.revision, body.userEn, requestId);
  }

  @Get(':attemptId')
  family(
    @CurrentUser() user: User,
    @Param('attemptId', attemptIdPipe) attemptId: string,
  ): Promise<AttemptFamilyResponse> {
    return this.rewrite.family(user, attemptId);
  }
}
