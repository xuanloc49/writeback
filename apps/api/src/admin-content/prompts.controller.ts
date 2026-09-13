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
import type { User } from '@prisma/client';
import { CurrentUser, RequestId } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { AdminGuards } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createPromptSchema,
  listPromptsQuerySchema,
  updatePromptSchema,
  type CreatePromptBody,
  type ListPromptsQuery,
  type UpdatePromptBody,
} from './admin-content.dto';
import { contentIdPipe } from './content.helpers';
import { PromptsService, type PromptView } from './prompts.service';

@Controller('admin/prompts')
@UseGuards(...AdminGuards)
@Roles('editor', 'admin')
export class PromptsController {
  constructor(private readonly prompts: PromptsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listPromptsQuerySchema)) query: ListPromptsQuery,
  ): Promise<{ prompts: PromptView[] }> {
    return this.prompts.list(query);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createPromptSchema)) body: CreatePromptBody,
  ): Promise<PromptView> {
    return this.prompts.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', contentIdPipe) id: string,
    @Body(new ZodValidationPipe(updatePromptSchema)) body: UpdatePromptBody,
  ): Promise<PromptView> {
    return this.prompts.update(id, body);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('id', contentIdPipe) id: string,
    @CurrentUser() actor: User,
    @RequestId() requestId: string,
  ): Promise<PromptView> {
    return this.prompts.publish(id, actor, requestId);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(
    @Param('id', contentIdPipe) id: string,
    @CurrentUser() actor: User,
    @RequestId() requestId: string,
  ): Promise<PromptView> {
    return this.prompts.unpublish(id, actor, requestId);
  }

  @Delete(':id')
  remove(@Param('id', contentIdPipe) id: string): Promise<{ id: string; deletedAt: string }> {
    return this.prompts.softDelete(id);
  }
}
