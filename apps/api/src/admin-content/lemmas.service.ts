import { Inject, Injectable } from '@nestjs/common';
import type { Lemma, Prisma, User } from '@prisma/client';
import { normalizeHeadword, type ContentStatus } from '@writeback/shared';
import { AuditService } from '../audit/audit.service';
import { appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateLemmaBody,
  LemmaSortKey,
  ListLemmasQuery,
  UpdateLemmaBody,
} from './admin-content.dto';
import { auditActionFor, isUniqueViolation } from './content.helpers';
import { lemmaPublishReasons } from './publish-rules';

const LEMMA_ORDER: Record<LemmaSortKey, Prisma.LemmaOrderByWithRelationInput> = {
  headword: { headwordNormalized: 'asc' },
  createdAt: { createdAt: 'desc' },
  updatedAt: { updatedAt: 'desc' },
};
const DEFAULT_LEMMA_SORT: LemmaSortKey = 'headword';

/** Admin lemma CRUD — design §12.6, §13; PRD §10.3, §10.10. */
@Injectable()
export class LemmasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(query: ListLemmasQuery): Promise<{ lemmas: Lemma[] }> {
    const lemmas = await this.prisma.lemma.findMany({
      where: {
        deletedAt: null,
        ...(query.topicId !== undefined ? { topicId: query.topicId } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.includedInFree !== undefined
          ? { includedInFree: query.includedInFree === 'true' }
          : {}),
        ...(query.q !== undefined
          ? { headwordNormalized: { contains: normalizeHeadword(query.q) } }
          : {}),
      },
      orderBy: LEMMA_ORDER[query.sort ?? DEFAULT_LEMMA_SORT],
    });
    return { lemmas };
  }

  async create(body: CreateLemmaBody): Promise<Lemma> {
    const headwordNormalized = normalizeHeadword(body.headword);
    await this.requireTopic(body.topicId);
    await this.assertHeadwordFree(headwordNormalized);
    try {
      return await this.prisma.lemma.create({
        data: {
          headword: body.headword,
          headwordNormalized,
          pos: body.pos ?? null,
          phonetic: body.phonetic ?? null,
          senseVi: body.senseVi,
          exampleEn: body.exampleEn ?? null,
          notesVi: body.notesVi ?? null,
          topicId: body.topicId,
          includedInFree: body.includedInFree ?? false,
          cefr: body.cefr ?? null,
          status: 'draft',
        },
      });
    } catch (error) {
      throw isUniqueViolation(error) ? appError('CONFLICT', { field: 'headword' }) : error;
    }
  }

  async update(id: string, body: UpdateLemmaBody): Promise<Lemma> {
    const lemma = await this.requireAlive(id);
    const { headword, topicId, ...rest } = body;
    const data: Prisma.LemmaUpdateInput = { ...rest };
    if (topicId !== undefined && topicId !== lemma.topicId) {
      await this.requireTopic(topicId);
      data.topic = { connect: { id: topicId } };
    }
    if (headword !== undefined) {
      const headwordNormalized = normalizeHeadword(headword);
      if (headwordNormalized !== lemma.headwordNormalized) {
        await this.assertHeadwordFree(headwordNormalized);
      }
      data.headword = headword;
      data.headwordNormalized = headwordNormalized;
    }
    try {
      return await this.prisma.lemma.update({ where: { id }, data });
    } catch (error) {
      throw isUniqueViolation(error) ? appError('CONFLICT', { field: 'headword' }) : error;
    }
  }

  /** Publish is blocked only by a blank `example_en` (design §13) — never by prompt count. */
  async publish(id: string, actor: User, requestId: string): Promise<Lemma> {
    const lemma = await this.requireAlive(id);
    const reasons = lemmaPublishReasons(lemma);
    if (reasons.length > 0) {
      throw appError('VALIDATION', { reasons });
    }
    return this.setStatus(lemma, 'published', actor, requestId);
  }

  async unpublish(id: string, actor: User, requestId: string): Promise<Lemma> {
    const lemma = await this.requireAlive(id);
    return this.setStatus(lemma, 'draft', actor, requestId);
  }

  async softDelete(id: string): Promise<{ id: string; deletedAt: string }> {
    const lemma = await this.requireAlive(id);
    const deletedAt = this.clock.now();
    await this.prisma.lemma.update({ where: { id: lemma.id }, data: { deletedAt } });
    return { id: lemma.id, deletedAt: deletedAt.toISOString() };
  }

  async requireAlive(id: string): Promise<Lemma> {
    const lemma = await this.prisma.lemma.findFirst({ where: { id, deletedAt: null } });
    if (lemma === null) {
      throw appError('NOT_FOUND');
    }
    return lemma;
  }

  private async setStatus(
    lemma: Lemma,
    status: ContentStatus,
    actor: User,
    requestId: string,
  ): Promise<Lemma> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.lemma.update({ where: { id: lemma.id }, data: { status } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: auditActionFor(status),
          targetType: 'lemma',
          targetId: lemma.id,
          props: { topicId: lemma.topicId },
          requestId,
        },
        tx,
      );
      return updated;
    });
  }

  private async requireTopic(topicId: string): Promise<void> {
    const topic = await this.prisma.topic.findFirst({ where: { id: topicId, deletedAt: null } });
    if (topic === null) {
      throw appError('VALIDATION', { reason: 'topic_not_found' });
    }
  }

  private async assertHeadwordFree(headwordNormalized: string): Promise<void> {
    const existing = await this.prisma.lemma.findFirst({
      where: { headwordNormalized, deletedAt: null },
    });
    if (existing !== null) {
      throw appError('CONFLICT', { field: 'headword', existingId: existing.id });
    }
  }
}
