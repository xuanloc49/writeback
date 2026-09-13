import { Injectable } from '@nestjs/common';
import { businessDate } from '@writeback/shared';
import { AnalyticsService } from '../analytics/analytics.service';
import { AppConfig } from '../config/app-config';
import type { Tx } from '../prisma/prisma.service';
import { nextStreak } from './streak';

type ActivityKind = 'review' | 'rewrite_new';

const DATE_ONLY_LENGTH = 'YYYY-MM-DD'.length;

/** `@db.Date` columns round-trip through Prisma as UTC midnight of the calendar day. */
function businessDateToColumn(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function columnToBusinessDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, DATE_ONLY_LENGTH);
}

/**
 * Daily activity + streak bookkeeping (PRD §10.6, design §7.7 `user_daily_activity`).
 * Both entry points MUST run inside the caller's transaction so the counters commit atomically
 * with the review / scored attempt they describe. Rev-2 rewrites never call this service.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly config: AppConfig,
  ) {}

  /** One graded SRS review at `now`. */
  async recordReview(
    tx: Tx,
    userId: string,
    now: Date,
    requestId: string | null = null,
  ): Promise<void> {
    await this.record(tx, userId, now, 'review', requestId);
  }

  /** One quota-charged rev-1 rewrite scored at `now`. */
  async recordRewriteNew(
    tx: Tx,
    userId: string,
    now: Date,
    requestId: string | null = null,
  ): Promise<void> {
    await this.record(tx, userId, now, 'rewrite_new', requestId);
  }

  private async record(
    tx: Tx,
    userId: string,
    now: Date,
    kind: ActivityKind,
    requestId: string | null,
  ): Promise<void> {
    const today = businessDate(now, this.config.businessTz);
    const date = businessDateToColumn(today);
    await tx.userDailyActivity.upsert({
      where: { userId_date: { userId, date } },
      create: {
        userId,
        date,
        reviewCount: kind === 'review' ? 1 : 0,
        rewriteNewCount: kind === 'rewrite_new' ? 1 : 0,
      },
      update:
        kind === 'review'
          ? { reviewCount: { increment: 1 } }
          : { rewriteNewCount: { increment: 1 } },
    });

    // Serialize concurrent streak updates for the same user (read-modify-write below).
    await tx.$executeRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { streakCount: true, streakLastDate: true },
    });
    const lastDate = columnToBusinessDate(user.streakLastDate);
    const next = nextStreak(user.streakCount, lastDate, today);
    if (next.streakLastDate === lastDate) {
      return;
    }
    await tx.user.update({
      where: { id: userId },
      data: {
        streakCount: next.streakCount,
        streakLastDate: businessDateToColumn(next.streakLastDate),
      },
    });
    if (next.streakCount > user.streakCount) {
      await this.analytics.track(
        'streak_incremented',
        userId,
        { streak_count: next.streakCount, source: kind },
        requestId,
        tx,
      );
    }
  }
}
