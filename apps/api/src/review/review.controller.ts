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
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  gradeSchema,
  type GradeBody,
  type GradeResponse,
  type NextResponse,
  type StartSessionResponse,
} from './review.dto';
import { ReviewService } from './review.service';

const sessionIdPipe = new ParseUUIDPipe({ exceptionFactory: () => appError('NOT_FOUND') });

/** Design §12.4. */
@Controller('review')
@UseGuards(SessionGuard, LearningGateGuard)
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Post('sessions')
  @HttpCode(HttpStatus.OK)
  start(@CurrentUser() user: User, @RequestId() requestId: string): Promise<StartSessionResponse> {
    return this.review.startSession(user, requestId);
  }

  @Get('sessions/:sessionId/next')
  next(
    @CurrentUser() user: User,
    @Param('sessionId', sessionIdPipe) sessionId: string,
  ): Promise<NextResponse> {
    return this.review.next(user, sessionId);
  }

  @Post('sessions/:sessionId/grade')
  @HttpCode(HttpStatus.OK)
  grade(
    @CurrentUser() user: User,
    @Param('sessionId', sessionIdPipe) sessionId: string,
    @Body(new ZodValidationPipe(gradeSchema)) body: GradeBody,
    @RequestId() requestId: string,
  ): Promise<GradeResponse> {
    return this.review.grade(user, sessionId, body, requestId);
  }
}
