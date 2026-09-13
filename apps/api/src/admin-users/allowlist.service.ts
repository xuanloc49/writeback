import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type BetaAllowlistEmail, type User } from '@prisma/client';
import { AUDIT_ACTIONS } from '../audit/audit-actions';
import { AuditService, maskEmail } from '../audit/audit.service';
import { appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_TARGET_TYPES } from './admin-users.constants';
import type { AllowlistEmailView, AllowlistView } from './admin-users.dto';

const PRISMA_UNIQUE_VIOLATION = 'P2002';
/** `audit_logs.target_id` for allowlist rows: the table has no surrogate id, so use a hash. */
const EMAIL_HASH_ALGORITHM = 'sha256';

/** Design §6.1/§12.7: `beta_allowlist_emails` is the source of truth; `enabled` is env-only in MVP. */
@Injectable()
export class AllowlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(): Promise<AllowlistView> {
    const rows = await this.prisma.betaAllowlistEmail.findMany({
      orderBy: [{ createdAt: 'desc' }, { email: 'asc' }],
    });
    return { enabled: this.config.betaAllowlistEnabled, emails: rows.map(toView) };
  }

  /** `email` arrives already trimmed + lower-cased from the DTO. */
  async add(actor: User, email: string, requestId: string): Promise<AllowlistEmailView> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.betaAllowlistEmail.create({
          data: { email, createdById: actor.id, createdAt: this.clock.now() },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: AUDIT_ACTIONS.ALLOWLIST_ADD,
            targetType: AUDIT_TARGET_TYPES.ALLOWLIST_EMAIL,
            targetId: emailHash(email),
            props: { emailMasked: maskEmail(email) },
            requestId,
          },
          tx,
        );
        return created;
      });
      return toView(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw appError('CONFLICT', { reason: 'email_exists' });
      }
      throw error;
    }
  }

  async remove(actor: User, rawEmail: string, requestId: string): Promise<{ email: string }> {
    const email = rawEmail.trim().toLowerCase();
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.betaAllowlistEmail.deleteMany({ where: { email } });
      if (deleted.count === 0) {
        throw appError('NOT_FOUND');
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: AUDIT_ACTIONS.ALLOWLIST_REMOVE,
          targetType: AUDIT_TARGET_TYPES.ALLOWLIST_EMAIL,
          targetId: emailHash(email),
          props: { emailMasked: maskEmail(email) },
          requestId,
        },
        tx,
      );
    });
    return { email };
  }
}

function toView(row: BetaAllowlistEmail): AllowlistEmailView {
  return { email: row.email, createdAt: row.createdAt.toISOString(), createdById: row.createdById };
}

function emailHash(email: string): string {
  return createHash(EMAIL_HASH_ALGORITHM).update(email).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === PRISMA_UNIQUE_VIOLATION
  );
}
