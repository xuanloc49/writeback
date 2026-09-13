import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Lemma, User } from '@prisma/client';
import { CurrentUser, RequestId } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { AdminGuards } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createLemmaSchema,
  listLemmasQuerySchema,
  updateLemmaSchema,
  type CreateLemmaBody,
  type ListLemmasQuery,
  type UpdateLemmaBody,
} from './admin-content.dto';
import { contentIdPipe } from './content.helpers';
import { LemmasService } from './lemmas.service';

@Controller('admin/lemmas')
@UseGuards(...AdminGuards)
@Roles('editor', 'admin')
export class LemmasController {
  constructor(private readonly lemmas: LemmasService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listLemmasQuerySchema)) query: ListLemmasQuery,
  ): Promise<{ lemmas: Lemma[] }> {
    return this.lemmas.list(query);
  }

  @Post()
  create(@Body(new ZodValidationPipe(createLemmaSchema)) body: CreateLemmaBody): Promise<Lemma> {
    return this.lemmas.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', contentIdPipe) id: string,
    @Body(new ZodValidationPipe(updateLemmaSchema)) body: UpdateLemmaBody,
  ): Promise<Lemma> {
    return this.lemmas.update(id, body);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('id', contentIdPipe) id: string,
    @CurrentUser() actor: User,
    @RequestId() requestId: string,
  ): Promise<Lemma> {
    return this.lemmas.publish(id, actor, requestId);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(
    @Param('id', contentIdPipe) id: string,
    @CurrentUser() actor: User,
    @RequestId() requestId: string,
  ): Promise<Lemma> {
    return this.lemmas.unpublish(id, actor, requestId);
  }

  @Delete(':id')
  remove(@Param('id', contentIdPipe) id: string): Promise<{ id: string; deletedAt: string }> {
    return this.lemmas.softDelete(id);
  }
}
