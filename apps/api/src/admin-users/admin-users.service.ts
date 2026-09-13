import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PlanChange, type User } from '@prisma/client';
import { businessDate, businessDayRange, REWRITE } from '@writeback/shared';
import { AUDIT_ACTIONS } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import { PlanLimitsService } from '../catalog/plan-limits.service';
import { VisibilityService } from '../catalog/visibility.service';
import { appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import { AppConfig } from '../config/app-config';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { ADMIN_USERS, AUDIT_TARGET_TYPES } from './admin-users.constants';
import type {
  AdminUserDetail,
  AdminUserRow,
  ChangePlanBody,
  ChangeRoleBody,
  ListUsersQuery,
  OverridesBody,
  Page,
  PlanChangeView,
} from './admin-users.dto';

const MS_PER_DAY = 86_400_000;
const REVISION_NEW = 1;
const REVISION_RETRY = REWRITE.MAX_REVISION;
const LAST_ADMIN_COUNT = 1;

interface UserStats {
  cardCount: number;
  rewriteNew7d: number;
}

/** Design §12.7 / PRD §10.11: user table, detail, plan/role changes, topic overrides. */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly planLimits: PlanLimitsService,
    private readonly quota: QuotaService,
    private readonly visibility: VisibilityService,
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(actor: User, query: ListUsersQuery, requestId: string): Promise<Page<AdminUserRow>> {
    const now = this.clock.now();
    const where: Prisma.UserWhereInput =
      query.q === undefined || query.q.length === 0
        ? {}
        : { email: { contains: query.q, mode: 'insensitive' } };
    const users = await this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
    });
    const pageUsers = users.slice(0, query.limit);
    const stats = await this.statsFor(
      pageUsers.map((user) => user.id),
      now,
    );
    await this.audit.record({
      actorId: actor.id,
      action: AUDIT_ACTIONS.USER_PII_VIEW,
      targetType: AUDIT_TARGET_TYPES.USER_LIST,
      props: { query: query.q ?? '', resultCount: pageUsers.length },
      requestId,
    });
    return {
      items: pageUsers.map((user) => toRow(user, stats.get(user.id))),
      nextCursor: users.length > query.limit ? (pageUsers.at(-1)?.id ?? null) : null,
    };
  }

  async detail(actor: User, targetId: string, requestId: string): Promise<AdminUserDetail> {
    const now = this.clock.now();
    const target = await this.requireUser(targetId);
    const { start, end } = businessDayRange(now, this.config.businessTz);
    const chargedToday: Prisma.RewriteAttemptWhereInput = {
      userId: target.id,
      quotaCharged: true,
      scoredAt: { gte: start, lt: end },
    };
    const [stats, onboarding, overrides, limits, left, rewriteNewUsed, retryUsed, planHistory] =
      await Promise.all([
        this.statsFor([target.id], now),
        this.prisma.userOnboardingTopic.findMany({
          where: { userId: target.id },
          select: { topicId: true },
        }),
        this.visibility.overrides(target.id),
        this.planLimits.forUser(target),
        this.quota.remaining(this.prisma, target, now),
        this.prisma.rewriteAttempt.count({ where: { ...chargedToday, revision: REVISION_NEW } }),
        this.prisma.rewriteAttempt.count({ where: { ...chargedToday, revision: REVISION_RETRY } }),
        this.prisma.planChange.findMany({
          where: { userId: target.id },
          orderBy: { createdAt: 'desc' },
          take: ADMIN_USERS.PLAN_HISTORY_LIMIT,
        }),
      ]);
    await this.audit.record({
      actorId: actor.id,
      action: AUDIT_ACTIONS.USER_PII_VIEW,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: target.id,
      requestId,
    });
    return {
      ...toRow(target, stats.get(target.id)),
      tosAcceptedAt: target.tosAcceptedAt?.toISOString() ?? null,
      onboardingCompletedAt: target.onboardingCompletedAt?.toISOString() ?? null,
      onboardingTopicIds: onboarding.map((row) => row.topicId),
      overrides: { allowTopicIds: [...overrides.allow], denyTopicIds: [...overrides.deny] },
      quotaToday: {
        date: businessDate(now, this.config.businessTz),
        limits,
        rewriteNewUsed,
        retryUsed,
        rewriteNewLeft: left.rewriteNewLeft,
        retryLeft: left.retryLeft,
      },
      planHistory: planHistory.map(toPlanChangeView),
    };
  }

  /** Effective immediately: quota math reads the current plan (PRD §8 mid-day rule). */
  async changePlan(
    actor: User,
    targetId: string,
    body: ChangePlanBody,
    requestId: string,
  ): Promise<PlanChangeView> {
    const target = await this.requireUser(targetId);
    if (target.plan === body.plan) {
      throw appError('VALIDATION', { reason: 'plan_unchanged' });
    }
    const change = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { plan: body.plan } });
      const row = await tx.planChange.create({
        data: {
          userId: target.id,
          fromPlan: target.plan,
          toPlan: body.plan,
          changedById: actor.id,
          note: body.note,
          createdAt: this.clock.now(),
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: AUDIT_ACTIONS.PLAN_CHANGE,
          targetType: AUDIT_TARGET_TYPES.USER,
          targetId: target.id,
          props: { fromPlan: target.plan, toPlan: body.plan, planChangeId: row.id },
          requestId,
        },
        tx,
      );
      return row;
    });
    return toPlanChangeView(change);
  }

  /** Never leaves the system without an admin (PRD §10.11, design §12.7). */
  async changeRole(
    actor: User,
    targetId: string,
    body: ChangeRoleBody,
    requestId: string,
  ): Promise<{ id: string; role: User['role'] }> {
    await this.prisma.$transaction(async (tx) => {
      await lockAdmins(tx);
      const target = await tx.user.findUnique({ where: { id: targetId } });
      if (target === null) {
        throw appError('NOT_FOUND');
      }
      if (target.role === body.role) {
        throw appError('VALIDATION', { reason: 'role_unchanged' });
      }
      if (target.role === 'admin') {
        const admins = await tx.user.count({ where: { role: 'admin' } });
        if (admins <= LAST_ADMIN_COUNT) {
          throw appError('VALIDATION', {
            reason: target.id === actor.id ? 'self_last_admin' : 'last_admin',
          });
        }
      }
      await tx.user.update({ where: { id: target.id }, data: { role: body.role } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: AUDIT_ACTIONS.ROLE_CHANGE,
          targetType: AUDIT_TARGET_TYPES.USER,
          targetId: target.id,
          props: { fromRole: target.role, toRole: body.role, noteLength: body.note.length },
          requestId,
        },
        tx,
      );
    });
    return { id: targetId, role: body.role };
  }

  /** Replaces the whole override set atomically (topic-level only; no lemma overrides exist). */
  async replaceOverrides(
    actor: User,
    targetId: string,
    body: OverridesBody,
    requestId: string,
  ): Promise<OverridesBody> {
    const target = await this.requireUser(targetId);
    const topicIds = [...body.allowTopicIds, ...body.denyTopicIds];
    const alive = await this.prisma.topic.count({
      where: { id: { in: topicIds }, deletedAt: null },
    });
    if (alive !== topicIds.length) {
      throw appError('VALIDATION', { reason: 'topic_not_found' });
    }
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.userTopicOverride.deleteMany({ where: { userId: target.id } });
      await tx.userTopicOverride.createMany({
        data: [
          ...body.allowTopicIds.map((topicId) => ({
            userId: target.id,
            topicId,
            kind: 'allow' as const,
            createdById: actor.id,
            createdAt: now,
          })),
          ...body.denyTopicIds.map((topicId) => ({
            userId: target.id,
            topicId,
            kind: 'deny' as const,
            createdById: actor.id,
            createdAt: now,
          })),
        ],
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: AUDIT_ACTIONS.OVERRIDE_CHANGE,
          targetType: AUDIT_TARGET_TYPES.USER,
          targetId: target.id,
          props: { allowCount: body.allowTopicIds.length, denyCount: body.denyTopicIds.length },
          requestId,
        },
        tx,
      );
    });
    return { allowTopicIds: body.allowTopicIds, denyTopicIds: body.denyTopicIds };
  }

  private async requireUser(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (user === null) {
      throw appError('NOT_FOUND');
    }
    return user;
  }

  private async statsFor(userIds: string[], now: Date): Promise<Map<string, UserStats>> {
    const stats = new Map<string, UserStats>();
    if (userIds.length === 0) {
      return stats;
    }
    const since = new Date(now.getTime() - ADMIN_USERS.REWRITE_WINDOW_DAYS * MS_PER_DAY);
    const [cards, rewrites] = await Promise.all([
      this.prisma.srsCard.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, hiddenAt: null },
        _count: { _all: true },
      }),
      this.prisma.rewriteAttempt.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIds },
          revision: REVISION_NEW,
          quotaCharged: true,
          scoredAt: { gte: since, lte: now },
        },
        _count: { _all: true },
      }),
    ]);
    const cardCounts = new Map(cards.map((row) => [row.userId, row._count._all]));
    const rewriteCounts = new Map(rewrites.map((row) => [row.userId, row._count._all]));
    for (const id of userIds) {
      stats.set(id, {
        cardCount: cardCounts.get(id) ?? 0,
        rewriteNew7d: rewriteCounts.get(id) ?? 0,
      });
    }
    return stats;
  }
}

/** Serialises concurrent role changes so two demotions cannot both pass the last-admin check. */
async function lockAdmins(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT id FROM users WHERE role = 'admin' FOR UPDATE`;
}

function toRow(user: User, stats: UserStats | undefined): AdminUserRow {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    plan: user.plan,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    cardCount: stats?.cardCount ?? 0,
    rewriteNew7d: stats?.rewriteNew7d ?? 0,
  };
}

function toPlanChangeView(row: PlanChange): PlanChangeView {
  return {
    id: row.id,
    fromPlan: row.fromPlan,
    toPlan: row.toPlan,
    changedById: row.changedById,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}
