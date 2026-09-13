import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { isStaffRole, ONBOARDING, type MeDto } from '@writeback/shared';
import { VisibilityService } from '../catalog/visibility.service';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';

export type GateReason = MeDto['learningBlockedReason'];

export interface GateResult {
  blocked: boolean;
  reason: GateReason;
  onboardingTopicIds: string[];
}

/** Evaluates design §6.1 gates 2–4 (ToS version, beta allowlist, onboarding). */
@Injectable()
export class LearningGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly visibility: VisibilityService,
  ) {}

  async evaluate(user: User): Promise<GateResult> {
    const onboardingTopicIds = await this.onboardingTopicIds(user.id);
    if (!(await this.tosCurrent(user))) {
      return { blocked: true, reason: 'TOS_REQUIRED', onboardingTopicIds };
    }
    if (!(await this.betaAllowed(user))) {
      return { blocked: true, reason: 'BETA_BLOCKED', onboardingTopicIds };
    }
    if (!(await this.onboardingComplete(user, onboardingTopicIds))) {
      return { blocked: true, reason: 'ONBOARDING_REQUIRED', onboardingTopicIds };
    }
    return { blocked: false, reason: null, onboardingTopicIds };
  }

  /** Gates 2 and 3 only (used by onboarding + topics endpoints). */
  async evaluatePreOnboarding(user: User): Promise<GateReason> {
    if (!(await this.tosCurrent(user))) {
      return 'TOS_REQUIRED';
    }
    if (!(await this.betaAllowed(user))) {
      return 'BETA_BLOCKED';
    }
    return null;
  }

  async onboardingTopicIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.userOnboardingTopic.findMany({
      where: { userId },
      select: { topicId: true },
    });
    return rows.map((row) => row.topicId);
  }

  private async tosCurrent(user: User): Promise<boolean> {
    if (user.tosAcceptedAt === null) {
      return false;
    }
    const latest = await this.prisma.tosAcceptance.findFirst({
      where: { userId: user.id },
      orderBy: { acceptedAt: 'desc' },
    });
    return (
      latest !== null &&
      latest.tosVersion === this.config.tosVersion &&
      latest.privacyVersion === this.config.privacyVersion
    );
  }

  private async betaAllowed(user: User): Promise<boolean> {
    if (!this.config.betaAllowlistEnabled || isStaffRole(user.role)) {
      return true;
    }
    const row = await this.prisma.betaAllowlistEmail.findUnique({
      where: { email: user.email.trim().toLowerCase() },
    });
    return row !== null;
  }

  private async onboardingComplete(user: User, topicIds: string[]): Promise<boolean> {
    if (topicIds.length < ONBOARDING.MIN_TOPICS || topicIds.length > ONBOARDING.MAX_TOPICS) {
      return false;
    }
    const visible = await this.visibility.visibleTopicIds(user, topicIds);
    return visible.size === topicIds.length;
  }
}
