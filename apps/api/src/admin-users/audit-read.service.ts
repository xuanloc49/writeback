import { Injectable } from '@nestjs/common';
import type { AuditLog, Prisma, User } from '@prisma/client';
import { isAuditAction } from '../audit/audit-actions';
import { appError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditQuery, AuditRowView, Page } from './admin-users.dto';

/** Design §12.7: admins read every row; support only rows they authored. */
@Injectable()
export class AuditReadService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: User, query: AuditQuery): Promise<Page<AuditRowView>> {
    if (query.action !== undefined && !isAuditAction(query.action)) {
      throw appError('VALIDATION', { reason: 'unknown_action' });
    }
    const where: Prisma.AuditLogWhereInput = {
      ...(actor.role === 'admin' ? {} : { actorId: actor.id }),
      ...(query.action === undefined ? {} : { action: query.action }),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toView),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}

function toView(row: AuditLog): AuditRowView {
  return {
    id: row.id,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    props: row.props,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  };
}
