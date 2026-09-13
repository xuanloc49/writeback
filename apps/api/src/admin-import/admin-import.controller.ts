import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { CurrentUser, RequestId } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { AdminGuards } from '../auth/roles.guard';
import { contentIdPipe } from '../admin-content/content.helpers';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  commitImportSchema,
  dryRunQuerySchema,
  type CommitImportBody,
  type CommitResponse,
  type DryRunQuery,
  type DryRunResponse,
  type PublishAllResponse,
} from './admin-import.dto';
import { AdminImportService } from './admin-import.service';

/**
 * `/v1/admin/import/*` — editor + admin. The JSON body limit (`CONTENT.IMPORT_MAX_BYTES`) is
 * enforced by the body parser in `app.setup.ts`; oversize → 413 `PAYLOAD_TOO_LARGE`.
 */
@Controller('admin/import')
@UseGuards(...AdminGuards)
@Roles('editor', 'admin')
export class AdminImportController {
  constructor(private readonly imports: AdminImportService) {}

  /** Body is the raw import document: schema failures become row-level errors in the report. */
  @Post('dry-run')
  @HttpCode(HttpStatus.OK)
  dryRun(
    @CurrentUser() actor: User,
    @Body() document: unknown,
    @Query(new ZodValidationPipe(dryRunQuerySchema)) query: DryRunQuery,
    @RequestId() requestId: string,
  ): Promise<DryRunResponse> {
    return this.imports.dryRun(actor, document, query.filename, requestId);
  }

  @Post('commit')
  @HttpCode(HttpStatus.OK)
  commit(
    @CurrentUser() actor: User,
    @Body(new ZodValidationPipe(commitImportSchema)) body: CommitImportBody,
    @RequestId() requestId: string,
  ): Promise<CommitResponse> {
    return this.imports.commit(actor, body.batchId, requestId);
  }

  @Post(':batchId/publish-all')
  @HttpCode(HttpStatus.OK)
  publishAll(
    @CurrentUser() actor: User,
    @Param('batchId', contentIdPipe) batchId: string,
    @RequestId() requestId: string,
  ): Promise<PublishAllResponse> {
    return this.imports.publishAll(actor, batchId, requestId);
  }
}
