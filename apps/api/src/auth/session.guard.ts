import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { isStaffRole, SESSION } from '@writeback/shared';
import { appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import type { AppRequest, Principal } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves the `wb.session` cookie to a database session row and attaches the principal.
 * Design §12.8: when the session owner (actor) has an open `impersonation_sessions` row, the
 * effective `principal.user` is the target; `sessions.user_id` is never rewritten.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const token = req.cookies?.[SESSION.COOKIE_NAME];
    if (token === undefined || token.length === 0) {
      throw appError('UNAUTHENTICATED');
    }
    const now = this.clock.now();
    const session = await this.prisma.session.findUnique({
      where: { sessionToken: token },
      include: { user: true },
    });
    if (session === null || session.expires <= now) {
      throw appError('UNAUTHENTICATED');
    }
    req.principal = await this.resolvePrincipal(session.user, now);
    return true;
  }

  /** Only staff can hold impersonation rows, so non-staff skip the extra lookup. */
  private async resolvePrincipal(actor: User, now: Date): Promise<Principal> {
    const plain: Principal = { user: actor, impersonatorId: null, actor };
    if (!isStaffRole(actor.role)) {
      return plain;
    }
    const open = await this.prisma.impersonationSession.findFirst({
      where: { actorId: actor.id, endedAt: null },
      include: { target: true },
    });
    if (open === null) {
      return plain;
    }
    if (open.expiresAt <= now) {
      // TTL elapsed: treat as ended and close the row lazily so the partial unique index frees up.
      await this.prisma.impersonationSession.updateMany({
        where: { id: open.id, endedAt: null },
        data: { endedAt: now },
      });
      return plain;
    }
    return { user: open.target, impersonatorId: actor.id, actor };
  }
}
