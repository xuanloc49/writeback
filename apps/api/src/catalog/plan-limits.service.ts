import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { limitProfileFor, type LimitProfile, type PlanLimits } from '@writeback/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';

/** Reads `plan_limits` by profile with a small in-process cache (reference data). */
@Injectable()
export class PlanLimitsService {
  private readonly cache = new Map<LimitProfile, PlanLimits>();

  constructor(private readonly prisma: PrismaService) {}

  profileFor(user: Pick<User, 'role' | 'plan'>): LimitProfile {
    return limitProfileFor(user.role, user.plan);
  }

  async forUser(user: Pick<User, 'role' | 'plan'>, tx: Tx = this.prisma): Promise<PlanLimits> {
    return this.forProfile(this.profileFor(user), tx);
  }

  async forProfile(profile: LimitProfile, tx: Tx = this.prisma): Promise<PlanLimits> {
    const cached = this.cache.get(profile);
    if (cached !== undefined) {
      return cached;
    }
    const row = await tx.planLimit.findUnique({ where: { profile } });
    if (row === null) {
      throw new Error(`plan_limits row missing for profile "${profile}"`);
    }
    const limits: PlanLimits = {
      rewriteNewPerDay: row.rewriteNewPerDay,
      retryPerDay: row.retryPerDay,
      reviewSessionCap: row.reviewSessionCap,
      newCardsUsedNaturalPerDay: row.newCardsUsedNaturalPerDay,
    };
    this.cache.set(profile, limits);
    return limits;
  }
}
