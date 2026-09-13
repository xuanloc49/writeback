import { Inject, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { MeDto } from '@writeback/shared';
import { LearningGateService } from '../auth/learning-gate.service';
import { PlanLimitsService } from '../catalog/plan-limits.service';
import { VisibilityService } from '../catalog/visibility.service';
import { appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly gate: LearningGateService,
    private readonly planLimits: PlanLimitsService,
    private readonly visibility: VisibilityService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async me(user: User, impersonatorId: string | null): Promise<MeDto> {
    const [gate, limits] = await Promise.all([
      this.gate.evaluate(user),
      this.planLimits.forUser(user),
    ]);
    return {
      id: user.id,
      email: user.email,
      name: user.name ?? '',
      role: user.role,
      plan: user.plan,
      tosAcceptedAt: user.tosAcceptedAt?.toISOString() ?? null,
      onboardingTopicIds: gate.onboardingTopicIds,
      learningBlocked: gate.blocked,
      learningBlockedReason: gate.reason,
      impersonatorId,
      limits,
    };
  }

  async acceptTos(user: User): Promise<{ tosAcceptedAt: string }> {
    const now = this.clock.now();
    await this.prisma.$transaction([
      this.prisma.tosAcceptance.create({
        data: {
          userId: user.id,
          acceptedAt: now,
          tosVersion: this.config.tosVersion,
          privacyVersion: this.config.privacyVersion,
          ageAttested: true,
        },
      }),
      this.prisma.user.update({ where: { id: user.id }, data: { tosAcceptedAt: now } }),
    ]);
    return { tosAcceptedAt: now.toISOString() };
  }

  async setOnboarding(user: User, topicIds: string[]): Promise<{ topicIds: string[] }> {
    await this.requirePreOnboardingGates(user);
    const visible = await this.visibility.visibleTopicIds(user, topicIds);
    if (visible.size !== topicIds.length) {
      throw appError('VALIDATION', { reason: 'topic_not_visible' });
    }
    await this.prisma.$transaction([
      this.prisma.userOnboardingTopic.deleteMany({ where: { userId: user.id } }),
      this.prisma.userOnboardingTopic.createMany({
        data: topicIds.map((topicId) => ({ userId: user.id, topicId })),
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { onboardingCompletedAt: this.clock.now() },
      }),
    ]);
    return { topicIds };
  }

  async visibleTopics(user: User): Promise<{ topics: { id: string; nameVi: string }[] }> {
    await this.requirePreOnboardingGates(user);
    const ids = await this.visibility.visibleTopicIds(user);
    const topics = await this.prisma.topic.findMany({
      where: { id: { in: [...ids] } },
      orderBy: { nameVi: 'asc' },
      select: { id: true, nameVi: true },
    });
    return { topics };
  }

  private async requirePreOnboardingGates(user: User): Promise<void> {
    const reason = await this.gate.evaluatePreOnboarding(user);
    if (reason !== null) {
      throw appError(reason);
    }
  }
}
