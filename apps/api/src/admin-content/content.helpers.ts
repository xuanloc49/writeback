import { ParseUUIDPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ContentStatus } from '@writeback/shared';
import { AUDIT_ACTIONS, type AuditAction } from '../audit/audit-actions';
import { appError } from '../common/app-error';

export type ContentTargetType = 'topic' | 'lemma' | 'prompt';

/** Audit action for a status transition (PRD §10.10: every publish/unpublish is audited). */
export function auditActionFor(status: ContentStatus): AuditAction {
  return status === 'published' ? AUDIT_ACTIONS.CONTENT_PUBLISH : AUDIT_ACTIONS.CONTENT_UNPUBLISH;
}

/** Prisma unique-index violation (e.g. the alive-unique partial indexes of design §7.6). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Path ids that are not UUIDs are treated as unknown resources. */
export const contentIdPipe = new ParseUUIDPipe({ exceptionFactory: () => appError('NOT_FOUND') });

/** Case-insensitive substring match helper for admin list search. */
export function containsInsensitive(q: string): Prisma.StringFilter {
  return { contains: q, mode: 'insensitive' };
}
