import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { CurrentUser, RequestId } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { AdminGuards } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  allowlistAddSchema,
  type AllowlistAddBody,
  type AllowlistEmailView,
  type AllowlistView,
} from './admin-users.dto';
import { AllowlistService } from './allowlist.service';

/** Design §12.7: beta allowlist CRUD — `admin` only. The `enabled` flag is env-only (no toggle). */
@Controller('admin/allowlist')
@UseGuards(...AdminGuards)
@Roles('admin')
export class AllowlistController {
  constructor(private readonly allowlist: AllowlistService) {}

  @Get()
  list(): Promise<AllowlistView> {
    return this.allowlist.list();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  add(
    @CurrentUser() actor: User,
    @Body(new ZodValidationPipe(allowlistAddSchema)) body: AllowlistAddBody,
    @RequestId() requestId: string,
  ): Promise<AllowlistEmailView> {
    return this.allowlist.add(actor, body.email, requestId);
  }

  @Delete(':email')
  remove(
    @CurrentUser() actor: User,
    @Param('email') email: string,
    @RequestId() requestId: string,
  ): Promise<{ email: string }> {
    return this.allowlist.remove(actor, email, requestId);
  }
}
