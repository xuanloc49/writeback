import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CLOCK, type Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ACTIONS, isAuditAction } from './audit-actions';

/** Keys that must never reach `audit_logs.props` (design §7.7, PRD §10.11). */
const FORBIDDEN_PROP_KEYS: ReadonlySet<string> = new Set([
  'user_en',
  'sample_en',
  'model_rewrite_en',
  'userEn',
  'sampleEn',
  'modelRewriteEn',
]);
const EMAIL_KEY = 'email';
const EMAIL_MASK = '***';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  props?: Record<string, unknown>;
  requestId?: string | null;
}

/**
 * Append-only writer for `audit_logs` (PRD §10.11, design §7.7, §12.7).
 * Deliberately exposes no update/delete: retention is 365 days, handled outside the API.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async record(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    if (!isAuditAction(entry.action)) {
      throw new Error(`unknown audit action: ${entry.action}`);
    }
    const props = sanitizeProps(entry.props ?? {}, entry.action === AUDIT_ACTIONS.USER_PII_VIEW);
    await tx.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        props: props as Prisma.InputJsonObject,
        requestId: entry.requestId ?? null,
        createdAt: this.clock.now(),
      },
    });
  }
}

/** Rejects forbidden keys anywhere in the payload; masks `email` unless the action is a PII view. */
function sanitizeProps(
  props: Record<string, unknown>,
  allowEmail: boolean,
): Record<string, unknown> {
  const offending = [...collectKeys(props)].filter((key) => FORBIDDEN_PROP_KEYS.has(key));
  if (offending.length > 0) {
    throw new Error(`audit props contain forbidden keys: ${offending.join(', ')}`);
  }
  if (allowEmail) {
    return props;
  }
  return maskEmails(props) as Record<string, unknown>;
}

function collectKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, acc);
    }
  } else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      acc.add(key);
      collectKeys(inner, acc);
    }
  }
  return acc;
}

function maskEmails(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(maskEmails);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] =
        key === EMAIL_KEY && typeof inner === 'string' ? maskEmail(inner) : maskEmails(inner);
    }
    return out;
  }
  return value;
}

/** `alice@example.com` → `a***@example.com`. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) {
    return EMAIL_MASK;
  }
  return `${email[0]}${EMAIL_MASK}${email.slice(at)}`;
}
