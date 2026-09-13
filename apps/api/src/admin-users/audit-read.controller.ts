import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { AdminGuards } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { auditQuerySchema, type AuditQuery, type AuditRowView, type Page } from './admin-users.dto';
import { AuditReadService } from './audit-read.service';

/** Design §12.7: `admin` sees every row, `support` only their own; others 403. */
@Controller('admin/audit')
@UseGuards(...AdminGuards)
@Roles('support', 'admin')
export class AuditReadController {
  constructor(private readonly audit: AuditReadService) {}

  @Get()
  list(
    @CurrentUser() actor: User,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
  ): Promise<Page<AuditRowView>> {
    return this.audit.list(actor, query);
  }
}
