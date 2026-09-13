import { Injectable } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { businessDayRange } from '@writeback/shared';
import { PlanLimitsService } from '../catalog/plan-limits.service';
import { AppConfig } from '../config/app-config';
import type { Tx } from '../prisma/prisma.service';

export interface QuotaLeft {
  rewriteNewLeft: number;
  retryLeft: number;
}

const REVISION_NEW = 1;
const REVISION_RETRY = 2;

/** Design §9.1: remaining = max(0, limit − charged rows today + grants today). */
@Injectable()
export class QuotaService {
  constructor(
    private readonly planLimits: PlanLimitsService,
    private readonly config: AppConfig,
  ) {}

  /** Locks the user row; must be called first inside the caller's transaction. */
  async lockUser(tx: Tx, userId: string): Promise<void> {
    await tx.$executeRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  }

  async remaining(tx: Tx, user: Pick<User, 'id' | 'role' | 'plan'>, now: Date): Promise<QuotaLeft> {
    const limits = await this.planLimits.forUser(user, tx);
    const { start, end } = businessDayRange(now, this.config.businessTz);
    const chargedToday: Prisma.RewriteAttemptWhereInput = {
      userId: user.id,
      quotaCharged: true,
      scoredAt: { gte: start, lt: end },
    };
    const [newUsed, retryUsed, grants] = await Promise.all([
      tx.rewriteAttempt.count({ where: { ...chargedToday, revision: REVISION_NEW } }),
      tx.rewriteAttempt.count({ where: { ...chargedToday, revision: REVISION_RETRY } }),
      tx.quotaGrant.aggregate({
        _sum: { extraRewriteNew: true, extraRetry: true },
        where: { userId: user.id, date: businessDateAsUtcMidnight(now, this.config.businessTz) },
      }),
    ]);
    return {
      rewriteNewLeft: computeLeft(limits.rewriteNewPerDay, newUsed, grants._sum.extraRewriteNew ?? 0),
      retryLeft: computeLeft(limits.retryPerDay, retryUsed, grants._sum.extraRetry ?? 0),
    };
  }
}

export function computeLeft(limit: number, used: number, granted: number): number {
  return Math.max(0, limit - used + granted);
}

/** `quota_grants.date` is a DATE column; Prisma maps it to UTC midnight of that calendar day. */
function businessDateAsUtcMidnight(now: Date, tz: string): Date {
  const { start } = businessDayRange(now, tz);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(start);
  return new Date(`${parts}T00:00:00.000Z`);
}
