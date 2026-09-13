import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { CurrentUser, RequestId } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { AdminGuards } from '../auth/roles.guard';
import { SessionGuard } from '../auth/session.guard';
import { appError } from '../common/app-error';
import type { AppRequest } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  impersonateSchema,
  quotaGrantSchema,
  type ImpersonateBody,
  type ImpersonateResponse,
  type QuotaGrantBody,
  type QuotaGrantResponse,
  type StopImpersonateResponse,
} from './support.dto';
import { SupportService } from './support.service';

const userIdPipe = new ParseUUIDPipe({ exceptionFactory: () => appError('NOT_FOUND') });

/** Design §12.8: impersonate + quota grants for `support` and `admin`. */
@Controller('admin/users')
@UseGuards(...AdminGuards)
@Roles('support', 'admin')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post(':id/impersonate')
  @HttpCode(HttpStatus.OK)
  impersonate(
    @CurrentUser() actor: User,
    @Param('id', userIdPipe) id: string,
    @Body(new ZodValidationPipe(impersonateSchema)) body: ImpersonateBody,
    @RequestId() requestId: string,
  ): Promise<ImpersonateResponse> {
    return this.support.impersonate(actor, id, body.reason, requestId);
  }

  @Post(':id/quota-grants')
  @HttpCode(HttpStatus.OK)
  grantQuota(
    @CurrentUser() actor: User,
    @Param('id', userIdPipe) id: string,
    @Body(new ZodValidationPipe(quotaGrantSchema)) body: QuotaGrantBody,
    @RequestId() requestId: string,
  ): Promise<QuotaGrantResponse> {
    return this.support.grantQuota(actor, id, body, requestId);
  }
}

/**
 * `POST /admin/impersonate/stop` must work while impersonating (design §12.8: "Dừng … POST stop"),
 * so it runs behind `SessionGuard` only and acts on the real session owner (`principal.actor`).
 * The service still rejects non-staff actors with 403.
 */
@Controller('admin/impersonate')
@UseGuards(SessionGuard)
export class ImpersonateStopController {
  constructor(private readonly support: SupportService) {}

  @Post('stop')
  @HttpCode(HttpStatus.OK)
  stop(@Req() req: AppRequest, @RequestId() requestId: string): Promise<StopImpersonateResponse> {
    const principal = req.principal;
    if (principal === undefined) {
      throw appError('UNAUTHENTICATED');
    }
    return this.support.stop(principal.actor ?? principal.user, requestId);
  }
}
