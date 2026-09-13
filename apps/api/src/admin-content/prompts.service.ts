import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, Prompt, User } from '@prisma/client';
import type { ContentStatus } from '@writeback/shared';
import { AuditService } from '../audit/audit.service';
import { appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePromptBody, ListPromptsQuery, UpdatePromptBody } from './admin-content.dto';
import { auditActionFor, containsInsensitive, isUniqueViolation } from './content.helpers';
import { promptPublishReasons } from './publish-rules';

export type PromptView = Prompt & { targetLemmaIds: string[] };

const PROMPT_WITH_LINKS = {
  lemmaLinks: { select: { lemmaId: true }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.PromptInclude;
type PromptWithLinks = Prisma.PromptGetPayload<{ include: typeof PROMPT_WITH_LINKS }>;

/** Admin prompt CRUD — design §12.6, §13; PRD §10.3, §10.10. */
@Injectable()
export class PromptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(query: ListPromptsQuery): Promise<{ prompts: PromptView[] }> {
    const prompts = await this.prisma.prompt.findMany({
      where: {
        deletedAt: null,
        ...(query.topicId !== undefined ? { topicId: query.topicId } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.q !== undefined
          ? {
              OR: [
                { textVi: containsInsensitive(query.q) },
                { externalKey: containsInsensitive(query.q) },
              ],
            }
          : {}),
      },
      include: PROMPT_WITH_LINKS,
      orderBy: { createdAt: 'desc' },
    });
    return { prompts: prompts.map(toView) };
  }

  async create(body: CreatePromptBody): Promise<PromptView> {
    await this.requireTopic(body.topicId);
    await this.requireLemmas(body.targetLemmaIds);
    if (body.externalKey !== undefined) {
      await this.assertExternalKeyFree(body.externalKey);
    }
    try {
      const prompt = await this.prisma.prompt.create({
        data: {
          externalKey: body.externalKey ?? null,
          textVi: body.textVi,
          topicId: body.topicId,
          sampleEn: body.sampleEn ?? null,
          hintsVi: body.hintsVi ?? null,
          status: 'draft',
          lemmaLinks: { create: targetLinks(body.targetLemmaIds) },
        },
        include: PROMPT_WITH_LINKS,
      });
      return toView(prompt);
    } catch (error) {
      throw isUniqueViolation(error) ? appError('CONFLICT', { field: 'externalKey' }) : error;
    }
  }

  /** Replaces targets wholesale when `targetLemmaIds` is present (`sort_order` = array position). */
  async update(id: string, body: UpdatePromptBody): Promise<PromptView> {
    const prompt = await this.requireAlive(id);
    const { targetLemmaIds, topicId, externalKey, ...rest } = body;
    const data: Prisma.PromptUpdateInput = { ...rest };
    if (topicId !== undefined && topicId !== prompt.topicId) {
      await this.requireTopic(topicId);
      data.topic = { connect: { id: topicId } };
    }
    if (externalKey !== undefined) {
      if (externalKey !== null && externalKey !== prompt.externalKey) {
        await this.assertExternalKeyFree(externalKey);
      }
      data.externalKey = externalKey;
    }
    if (targetLemmaIds !== undefined) {
      await this.requireLemmas(targetLemmaIds);
    }
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (targetLemmaIds !== undefined) {
          await tx.promptLemma.deleteMany({ where: { promptId: id } });
          data.lemmaLinks = { create: targetLinks(targetLemmaIds) };
        }
        return tx.prompt.update({ where: { id }, data, include: PROMPT_WITH_LINKS });
      });
      return toView(updated);
    } catch (error) {
      throw isUniqueViolation(error) ? appError('CONFLICT', { field: 'externalKey' }) : error;
    }
  }

  /** Design §13: blank sample, non-published/deleted target, cross-topic target, or bad count. */
  async publish(id: string, actor: User, requestId: string): Promise<PromptView> {
    const prompt = await this.requireAlive(id);
    const targets = await this.prisma.lemma.findMany({
      where: { id: { in: prompt.lemmaLinks.map((link) => link.lemmaId) } },
      select: { status: true, deletedAt: true, topicId: true },
    });
    const reasons = promptPublishReasons(prompt, targets);
    if (reasons.length > 0) {
      throw appError('VALIDATION', { reasons });
    }
    return this.setStatus(prompt, 'published', actor, requestId);
  }

  /** Never cascades to lemmas (design §13). */
  async unpublish(id: string, actor: User, requestId: string): Promise<PromptView> {
    const prompt = await this.requireAlive(id);
    return this.setStatus(prompt, 'draft', actor, requestId);
  }

  async softDelete(id: string): Promise<{ id: string; deletedAt: string }> {
    const prompt = await this.requireAlive(id);
    const deletedAt = this.clock.now();
    await this.prisma.prompt.update({ where: { id: prompt.id }, data: { deletedAt } });
    return { id: prompt.id, deletedAt: deletedAt.toISOString() };
  }

  async requireAlive(id: string): Promise<PromptWithLinks> {
    const prompt = await this.prisma.prompt.findFirst({
      where: { id, deletedAt: null },
      include: PROMPT_WITH_LINKS,
    });
    if (prompt === null) {
      throw appError('NOT_FOUND');
    }
    return prompt;
  }

  private async setStatus(
    prompt: PromptWithLinks,
    status: ContentStatus,
    actor: User,
    requestId: string,
  ): Promise<PromptView> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.prompt.update({
        where: { id: prompt.id },
        data: { status },
        include: PROMPT_WITH_LINKS,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: auditActionFor(status),
          targetType: 'prompt',
          targetId: prompt.id,
          props: { topicId: prompt.topicId },
          requestId,
        },
        tx,
      );
      return toView(updated);
    });
  }

  private async requireTopic(topicId: string): Promise<void> {
    const topic = await this.prisma.topic.findFirst({ where: { id: topicId, deletedAt: null } });
    if (topic === null) {
      throw appError('VALIDATION', { reason: 'topic_not_found' });
    }
  }

  /** Targets must exist and be alive; published/same-topic is a publish-time rule, not a save rule. */
  private async requireLemmas(lemmaIds: string[]): Promise<void> {
    const count = await this.prisma.lemma.count({
      where: { id: { in: lemmaIds }, deletedAt: null },
    });
    if (count !== lemmaIds.length) {
      throw appError('VALIDATION', { reason: 'target_not_found' });
    }
  }

  private async assertExternalKeyFree(externalKey: string): Promise<void> {
    const existing = await this.prisma.prompt.findFirst({
      where: { externalKey, deletedAt: null },
    });
    if (existing !== null) {
      throw appError('CONFLICT', { field: 'externalKey', existingId: existing.id });
    }
  }
}

function targetLinks(lemmaIds: string[]): { lemmaId: string; sortOrder: number }[] {
  return lemmaIds.map((lemmaId, index) => ({ lemmaId, sortOrder: index }));
}

function toView(prompt: PromptWithLinks): PromptView {
  const { lemmaLinks, ...rest } = prompt;
  return { ...rest, targetLemmaIds: lemmaLinks.map((link) => link.lemmaId) };
}
