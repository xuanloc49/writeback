import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { businessDate, isStaffRole, SUPPORT } from '@writeback/shared';
import { AUDIT_ACTIONS } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import { PlanLimitsService } from '../catalog/plan-limits.service';
import { appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { SUPPORT_TARGET_TYPES } from './support.constants';
import type {
  ImpersonateResponse,
  QuotaGrantBody,
  QuotaGrantResponse,
  StopImpersonateResponse,
} from './support.dto';

const MS_PER_SECOND = 1000;
const PRISMA_UNIQUE_VIOLATION = 'P2002';

/** Design §12.8 / PRD §10.13: impersonation sessions and quota grants. */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly planLimits: PlanLimitsService,
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async impersonate(
    actor: User,
    targetId: string,
    reason: string,
    requestId: string,
  ): Promise<ImpersonateResponse> {
    const now = this.clock.now();
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (target === null) {
      throw appError('NOT_FOUND');
    }
    if (target.role !== 'user') {
      throw appError('VALIDATION', { reason: 'target_not_user' });
    }
    // Expired rows still occupy the partial unique index; close them before inserting.
    await this.prisma.impersonationSession.updateMany({
      where: { actorId: actor.id, endedAt: null, expiresAt: { lte: now } },
      data: { endedAt: now },
    });
    const expiresAt = new Date(now.getTime() + SUPPORT.IMPERSONATE_TTL_SECONDS * MS_PER_SECOND);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.impersonationSession.create({
          data: { actorId: actor.id, targetId: target.id, reason, expiresAt, createdAt: now },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: AUDIT_ACTIONS.IMPERSONATE_START,
            targetType: SUPPORT_TARGET_TYPES.USER,
            targetId: target.id,
            props: {
              impersonationId: created.id,
              reasonLength: reason.length,
              expiresAt: expiresAt.toISOString(),
            },
            requestId,
          },
          tx,
        );
        return created;
      });
      return {
        impersonationId: row.id,
        targetId: row.targetId,
        expiresAt: expiresAt.toISOString(),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw appError('CONFLICT', { reason: 'impersonation_open' });
      }
      throw error;
    }
  }

  /**
   * Ends the actor's open session. Reachable while impersonating (the principal's `actor`), so
   * this is the one `/admin/*` route that is not closed to impersonated requests.
   */
  async stop(actor: User, requestId: string): Promise<StopImpersonateResponse> {
    if (!isStaffRole(actor.role)) {
      throw appError('FORBIDDEN');
    }
    const now = this.clock.now();
    const open = await this.prisma.impersonationSession.findFirst({
      where: { actorId: actor.id, endedAt: null, expiresAt: { gt: now } },
    });
    if (open === null) {
      throw appError('NOT_FOUND');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.impersonationSession.update({ where: { id: open.id }, data: { endedAt: now } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: AUDIT_ACTIONS.IMPERSONATE_STOP,
          targetType: SUPPORT_TARGET_TYPES.USER,
          targetId: open.targetId,
          props: { impersonationId: open.id },
          requestId,
        },
        tx,
      );
    });
    return { impersonationId: open.id, endedAt: now.toISOString() };
  }

  /** Adds a `quota_grants` row for today's business date; never touches `rewrite_attempts`. */
  async grantQuota(
    actor: User,
    targetId: string,
    body: QuotaGrantBody,
    requestId: string,
  ): Promise<QuotaGrantResponse> {
    const now = this.clock.now();
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (target === null) {
      throw appError('NOT_FOUND');
    }
    const limits = await this.planLimits.forUser(target);
    if (body.extraRewriteNew > limits.rewriteNewPerDay) {
      throw appError('VALIDATION', {
        reason: 'grant_above_cap',
        maxExtraRewriteNew: limits.rewriteNewPerDay,
      });
    }
    const date = businessDate(now, this.config.businessTz);
    const grant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.quotaGrant.create({
        data: {
          userId: target.id,
          date: businessDateAsUtcMidnight(date),
          extraRewriteNew: body.extraRewriteNew,
          extraRetry: body.extraRetry,
          reason: body.reason,
          createdById: actor.id,
          createdAt: now,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: AUDIT_ACTIONS.QUOTA_RESTORE,
          targetType: SUPPORT_TARGET_TYPES.USER,
          targetId: target.id,
          props: {
            grantId: created.id,
            date,
            extraRewriteNew: body.extraRewriteNew,
            extraRetry: body.extraRetry,
            reasonLength: body.reason.length,
          },
          requestId,
        },
        tx,
      );
      return created;
    });
    return {
      grantId: grant.id,
      date,
      extraRewriteNew: grant.extraRewriteNew,
      extraRetry: grant.extraRetry,
    };
  }
}

/** `quota_grants.date` is a DATE column; Prisma maps it to UTC midnight of that calendar day. */
function businessDateAsUtcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === PRISMA_UNIQUE_VIOLATION
  );
}
