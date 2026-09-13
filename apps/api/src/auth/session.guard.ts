import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { SESSION } from '@writeback/shared';
import { appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import type { AppRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

/** Resolves the `wb.session` cookie to a database session row and attaches the principal. */
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
    const session = await this.prisma.session.findUnique({
      where: { sessionToken: token },
      include: { user: true },
    });
    if (session === null || session.expires <= this.clock.now()) {
      throw appError('UNAUTHENTICATED');
    }
    req.principal = { user: session.user, impersonatorId: null };
    return true;
  }
}
