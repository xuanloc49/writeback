import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, Topic, User } from '@prisma/client';
import { CONTENT, type ContentStatus } from '@writeback/shared';
import { AuditService } from '../audit/audit.service';
import { appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateTopicBody,
  ListTopicsQuery,
  TopicContextView,
  UpdateTopicBody,
} from './admin-content.dto';
import { auditActionFor, containsInsensitive, isUniqueViolation } from './content.helpers';

/** Admin topic CRUD — design §12.6, §13; PRD §10.10. */
@Injectable()
export class TopicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(query: ListTopicsQuery): Promise<{ topics: Topic[] }> {
    const topics = await this.prisma.topic.findMany({
      where: {
        deletedAt: null,
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.q !== undefined
          ? {
              OR: [
                { slug: containsInsensitive(query.q) },
                { nameVi: containsInsensitive(query.q) },
              ],
            }
          : {}),
      },
      orderBy: { nameVi: 'asc' },
    });
    return { topics };
  }

  async create(body: CreateTopicBody): Promise<Topic> {
    await this.assertSlugFree(body.slug);
    try {
      return await this.prisma.topic.create({
        data: { slug: body.slug, nameVi: body.nameVi, status: 'draft' },
      });
    } catch (error) {
      throw isUniqueViolation(error) ? appError('CONFLICT', { field: 'slug' }) : error;
    }
  }

  async update(id: string, body: UpdateTopicBody): Promise<Topic> {
    const topic = await this.requireAlive(id);
    if (body.slug !== undefined && body.slug !== topic.slug) {
      await this.assertSlugFree(body.slug);
    }
    try {
      return await this.prisma.topic.update({ where: { id }, data: body });
    } catch (error) {
      throw isUniqueViolation(error) ? appError('CONFLICT', { field: 'slug' }) : error;
    }
  }

  async setStatus(
    id: string,
    status: ContentStatus,
    actor: User,
    requestId: string,
  ): Promise<Topic> {
    const topic = await this.requireAlive(id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.topic.update({ where: { id: topic.id }, data: { status } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: auditActionFor(status),
          targetType: 'topic',
          targetId: topic.id,
          props: { slug: topic.slug },
          requestId,
        },
        tx,
      );
      return updated;
    });
  }

  /** Soft delete; children stay in place but VisibilityService hides them (design §13). */
  async softDelete(id: string): Promise<{ id: string; deletedAt: string }> {
    const topic = await this.requireAlive(id);
    const deletedAt = this.clock.now();
    await this.prisma.topic.update({ where: { id: topic.id }, data: { deletedAt } });
    return { id: topic.id, deletedAt: deletedAt.toISOString() };
  }

  /** Counts + blockers: published lemmas covered by fewer than 2 published prompts (no exception). */
  async context(id: string): Promise<TopicContextView> {
    const topic = await this.requireAlive(id);
    const [lemmaGroups, promptGroups, publishedLemmas] = await Promise.all([
      this.prisma.lemma.groupBy({
        by: ['status'],
        where: { topicId: topic.id, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.prompt.groupBy({
        by: ['status'],
        where: { topicId: topic.id, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.lemma.findMany({
        where: { topicId: topic.id, deletedAt: null, status: 'published' },
        select: {
          id: true,
          headword: true,
          _count: {
            select: {
              promptLinks: { where: { prompt: { status: 'published', deletedAt: null } } },
            },
          },
        },
        orderBy: { headwordNormalized: 'asc' },
      }),
    ]);
    const blockers = publishedLemmas
      .filter((lemma) => lemma._count.promptLinks < CONTENT.MIN_PROMPTS_PER_PUBLISHED_LEMMA)
      .map((lemma) => ({
        lemmaId: lemma.id,
        headword: lemma.headword,
        publishedPromptCount: lemma._count.promptLinks,
      }));
    return {
      lemmaCounts: statusCounts(lemmaGroups),
      promptCounts: statusCounts(promptGroups),
      blockers,
    };
  }

  async requireAlive(id: string, tx: Prisma.TransactionClient = this.prisma): Promise<Topic> {
    const topic = await tx.topic.findFirst({ where: { id, deletedAt: null } });
    if (topic === null) {
      throw appError('NOT_FOUND');
    }
    return topic;
  }

  private async assertSlugFree(slug: string): Promise<void> {
    const existing = await this.prisma.topic.findFirst({ where: { slug, deletedAt: null } });
    if (existing !== null) {
      throw appError('CONFLICT', { field: 'slug' });
    }
  }
}

function statusCounts(groups: { status: ContentStatus; _count: { _all: number } }[]): {
  draft: number;
  published: number;
} {
  const counts = { draft: 0, published: 0 };
  for (const group of groups) {
    counts[group.status] = group._count._all;
  }
  return counts;
}
