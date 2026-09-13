import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { MeDto } from '@writeback/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard } from '../auth/session.guard';
import type { AppRequest } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { acceptTosSchema, onboardingSchema, type AcceptTosBody, type OnboardingBody } from './users.dto';
import { UsersService } from './users.service';

@Controller()
@UseGuards(SessionGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: User, @Req() req: AppRequest): Promise<MeDto> {
    return this.users.me(user, req.principal?.impersonatorId ?? null);
  }

  @Post('me/tos')
  acceptTos(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(acceptTosSchema)) _body: AcceptTosBody,
  ): Promise<{ tosAcceptedAt: string }> {
    return this.users.acceptTos(user);
  }

  @Put('me/onboarding')
  setOnboarding(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(onboardingSchema)) body: OnboardingBody,
  ): Promise<{ topicIds: string[] }> {
    return this.users.setOnboarding(user, body.topicIds);
  }

  @Get('topics')
  topics(@CurrentUser() user: User): Promise<{ topics: { id: string; nameVi: string }[] }> {
    return this.users.visibleTopics(user);
  }
}
