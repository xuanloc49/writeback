import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import type { MeDto } from '@writeback/shared';
import { LearningGateService } from '../auth/learning-gate.service';
import { PlanLimitsService } from '../catalog/plan-limits.service';
import { VisibilityService } from '../catalog/visibility.service';
import { appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import { AppConfig } from '../config/app-config';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const AUDIT_TARGET_TYPE_USER = 'user';
const EMAIL_KEY_PATTERN = /email/i;

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

  /**
   * Hard delete (PRD §10.9, design §6.0). FK cascades remove accounts/sessions/ToS/onboarding/
   * overrides/cards/attempts/review sessions/daily activity/quota grants/impersonation-as-target;
   * analytics rows keep `user_id = NULL` via SetNull. Audit rows are kept (UUIDs stay) but any
   * e-mail props are stripped first, inside the same transaction.
   */
  async deleteAccount(user: User): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await stripEmailFromAuditLogs(tx, user.id);
      await tx.user.delete({ where: { id: user.id } });
    });
  }

  private async requirePreOnboardingGates(user: User): Promise<void> {
    const reason = await this.gate.evaluatePreOnboarding(user);
    if (reason !== null) {
      throw appError(reason);
    }
  }
}

/** Removes every `*email*` key from `props` of audit rows about or by the user (design §6.0). */
async function stripEmailFromAuditLogs(tx: Tx, userId: string): Promise<void> {
  const rows = await tx.auditLog.findMany({
    where: {
      OR: [{ targetType: AUDIT_TARGET_TYPE_USER, targetId: userId }, { actorId: userId }],
    },
    select: { id: true, props: true },
  });
  for (const row of rows) {
    const stripped = stripEmailKeys(row.props);
    if (stripped.changed) {
      await tx.auditLog.update({
        where: { id: row.id },
        data: { props: stripped.value as Prisma.InputJsonValue },
      });
    }
  }
}

/** Recursively drops object keys matching `/email/i`; reports whether anything was removed. */
function stripEmailKeys(value: Prisma.JsonValue): { value: Prisma.JsonValue; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const result = stripEmailKeys(item);
      changed = changed || result.changed;
      return result.value;
    });
    return { value: items, changed };
  }
  if (value !== null && typeof value === 'object') {
    let changed = false;
    const out: Prisma.JsonObject = {};
    for (const [key, inner] of Object.entries(value)) {
      if (EMAIL_KEY_PATTERN.test(key)) {
        changed = true;
        continue;
      }
      const result = stripEmailKeys(inner ?? null);
      changed = changed || result.changed;
      out[key] = result.value;
    }
    return { value: out, changed };
  }
  return { value, changed: false };
}
