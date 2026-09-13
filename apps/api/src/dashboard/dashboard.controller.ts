import { Controller, Get, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { LearningGateGuard } from '../auth/learning-gate.guard';
import { SessionGuard } from '../auth/session.guard';
import type { DashboardResponse } from './dashboard.dto';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(SessionGuard, LearningGateGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@CurrentUser() user: User): Promise<DashboardResponse> {
    return this.dashboard.get(user);
  }
}
