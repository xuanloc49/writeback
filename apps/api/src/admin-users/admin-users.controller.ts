import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { CurrentUser, RequestId } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { AdminGuards } from '../auth/roles.guard';
import { appError } from '../common/app-error';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  changePlanSchema,
  changeRoleSchema,
  listUsersQuerySchema,
  overridesSchema,
  type AdminUserDetail,
  type AdminUserRow,
  type ChangePlanBody,
  type ChangeRoleBody,
  type ListUsersQuery,
  type OverridesBody,
  type Page,
  type PlanChangeView,
} from './admin-users.dto';
import { AdminUsersService } from './admin-users.service';

const userIdPipe = new ParseUUIDPipe({ exceptionFactory: () => appError('NOT_FOUND') });

/** Design §12.7: reads for `support`+`admin` (audited as PII views); mutations for `admin` only. */
@Controller('admin/users')
@UseGuards(...AdminGuards)
@Roles('support', 'admin')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(
    @CurrentUser() actor: User,
    @Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery,
    @RequestId() requestId: string,
  ): Promise<Page<AdminUserRow>> {
    return this.users.list(actor, query, requestId);
  }

  @Get(':id')
  detail(
    @CurrentUser() actor: User,
    @Param('id', userIdPipe) id: string,
    @RequestId() requestId: string,
  ): Promise<AdminUserDetail> {
    return this.users.detail(actor, id, requestId);
  }

  @Post(':id/plan')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  changePlan(
    @CurrentUser() actor: User,
    @Param('id', userIdPipe) id: string,
    @Body(new ZodValidationPipe(changePlanSchema)) body: ChangePlanBody,
    @RequestId() requestId: string,
  ): Promise<PlanChangeView> {
    return this.users.changePlan(actor, id, body, requestId);
  }

  @Post(':id/role')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  changeRole(
    @CurrentUser() actor: User,
    @Param('id', userIdPipe) id: string,
    @Body(new ZodValidationPipe(changeRoleSchema)) body: ChangeRoleBody,
    @RequestId() requestId: string,
  ): Promise<{ id: string; role: User['role'] }> {
    return this.users.changeRole(actor, id, body, requestId);
  }

  @Put(':id/overrides')
  @Roles('admin')
  replaceOverrides(
    @CurrentUser() actor: User,
    @Param('id', userIdPipe) id: string,
    @Body(new ZodValidationPipe(overridesSchema)) body: OverridesBody,
    @RequestId() requestId: string,
  ): Promise<OverridesBody> {
    return this.users.replaceOverrides(actor, id, body, requestId);
  }
}
