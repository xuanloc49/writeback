import type { AuditLog, Lemma, Prompt, Topic } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  createChargedAttempt,
  createLemma,
  createPrompt,
  createTopic,
  createUser,
  type CreatedUser,
  type CreateUserOptions,
} from './factories';

export const MS_PER_MINUTE = 60_000;

/** Staff account (ToS accepted) with a session cookie. */
export function createStaff(
  prisma: PrismaService,
  role: 'editor' | 'support' | 'admin',
  options: Omit<CreateUserOptions, 'role'> = {},
): Promise<CreatedUser> {
  return createUser(prisma, { ...options, role });
}

export interface LearnableTopic {
  topic: Topic;
  lemma: Lemma;
  prompt: Prompt;
}

/** Published topic with one free lemma and one prompt so a Free user can pass onboarding. */
export async function createLearnableTopic(prisma: PrismaService): Promise<LearnableTopic> {
  const topic = await createTopic(prisma);
  const lemma = await createLemma(prisma, { topicId: topic.id, includedInFree: true });
  const prompt = await createPrompt(prisma, { topicId: topic.id, targets: [lemma.id] });
  return { topic, lemma, prompt };
}

/** Inserts `count` charged rev-1 attempts scored at `scoredAt` (each one minute apart). */
export async function chargeRewriteNew(
  prisma: PrismaService,
  options: { userId: string; promptId: string; topicId: string; scoredAt: Date; count: number },
): Promise<void> {
  for (let i = 0; i < options.count; i += 1) {
    await createChargedAttempt(prisma, {
      userId: options.userId,
      promptId: options.promptId,
      topicId: options.topicId,
      scoredAt: new Date(options.scoredAt.getTime() - i * MS_PER_MINUTE),
    });
  }
}

export async function createOpenImpersonation(
  prisma: PrismaService,
  options: { actorId: string; targetId: string; expiresAt: Date; reason?: string },
): Promise<{ id: string }> {
  return prisma.impersonationSession.create({
    data: {
      actorId: options.actorId,
      targetId: options.targetId,
      reason: options.reason ?? 'test impersonation',
      expiresAt: options.expiresAt,
    },
    select: { id: true },
  });
}

export async function createAuditRow(
  prisma: PrismaService,
  options: { actorId: string; action: string; targetType?: string; targetId?: string },
): Promise<AuditLog> {
  return prisma.auditLog.create({
    data: {
      actorId: options.actorId,
      action: options.action,
      targetType: options.targetType ?? 'user',
      targetId: options.targetId ?? null,
      props: {},
    },
  });
}

export function auditRows(
  prisma: PrismaService,
  where: { action?: string; actorId?: string; targetId?: string },
): Promise<AuditLog[]> {
  return prisma.auditLog.findMany({ where, orderBy: { createdAt: 'asc' } });
}
