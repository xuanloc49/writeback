import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { REWRITE } from '@writeback/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AttemptFamilyResponse } from '../rewrite/rewrite.dto';
import { RewriteService } from '../rewrite/rewrite.service';
import { decodeHistoryCursor, encodeHistoryCursor, type HistoryCursor } from './history-cursor';
import { excerptOf, type HistoryItemView, type HistoryListResponse } from './history.dto';

const FIRST_REVISION = 1;
const SECOND_REVISION = REWRITE.MAX_REVISION;

@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rewrite: RewriteService,
  ) {}

  /** PRD §10.8: the user's own scored rev-1 attempts, newest first, keyset-paginated. */
  async list(
    user: User,
    cursorRaw: string | undefined,
    limit: number,
  ): Promise<HistoryListResponse> {
    const cursor = cursorRaw === undefined ? null : decodeHistoryCursor(cursorRaw);
    const rows = await this.prisma.rewriteAttempt.findMany({
      where: {
        userId: user.id,
        revision: FIRST_REVISION,
        status: 'scored',
        scoredAt: { not: null },
        ...(cursor === null ? {} : afterCursor(cursor)),
      },
      orderBy: [{ scoredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        attemptId: true,
        createdAt: true,
        scoredAt: true,
        overallScore: true,
        userEn: true,
        topicIdSnapshot: true,
        children: {
          where: { revision: SECOND_REVISION, status: 'scored' },
          select: { overallScore: true },
        },
      },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const topicNames = await this.topicNames(page.map((row) => row.topicIdSnapshot));
    const items: HistoryItemView[] = [];
    for (const row of page) {
      if (row.scoredAt === null) {
        continue;
      }
      const revision = row.children[0];
      items.push({
        attemptId: row.attemptId,
        createdAt: row.createdAt.toISOString(),
        scoredAt: row.scoredAt.toISOString(),
        topicNameVi: topicNames.get(row.topicIdSnapshot) ?? '',
        overallScore: row.overallScore ?? 0,
        excerpt: excerptOf(row.userEn ?? ''),
        hasRevision: revision !== undefined,
        revisionScore: revision?.overallScore ?? null,
      });
    }
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last !== undefined && last.scoredAt !== null
        ? encodeHistoryCursor({ scoredAt: last.scoredAt, id: last.id })
        : null;
    return { items, nextCursor };
  }

  /** Design §12.5: `GET /history/:attemptId` = the rewrite family view, no LLM call. */
  detail(user: User, attemptId: string): Promise<AttemptFamilyResponse> {
    return this.rewrite.family(user, attemptId);
  }

  private async topicNames(topicIds: string[]): Promise<Map<string, string>> {
    if (topicIds.length === 0) {
      return new Map();
    }
    const topics = await this.prisma.topic.findMany({
      where: { id: { in: [...new Set(topicIds)] } },
      select: { id: true, nameVi: true },
    });
    return new Map(topics.map((topic) => [topic.id, topic.nameVi]));
  }
}

/** Rows strictly after `cursor` in `(scored_at DESC, id DESC)` order. */
function afterCursor(cursor: HistoryCursor): Prisma.RewriteAttemptWhereInput {
  return {
    OR: [
      { scoredAt: { lt: cursor.scoredAt } },
      { scoredAt: cursor.scoredAt, id: { lt: cursor.id } },
    ],
  };
}
