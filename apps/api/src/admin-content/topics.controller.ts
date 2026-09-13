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
import type { Topic, User } from '@prisma/client';
import { CurrentUser, RequestId } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { AdminGuards } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createTopicSchema,
  listTopicsQuerySchema,
  updateTopicSchema,
  type CreateTopicBody,
  type ListTopicsQuery,
  type TopicContextView,
  type UpdateTopicBody,
} from './admin-content.dto';
import { contentIdPipe } from './content.helpers';
import { TopicsService } from './topics.service';

@Controller('admin/topics')
@UseGuards(...AdminGuards)
@Roles('editor', 'admin')
export class TopicsController {
  constructor(private readonly topics: TopicsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listTopicsQuerySchema)) query: ListTopicsQuery,
  ): Promise<{ topics: Topic[] }> {
    return this.topics.list(query);
  }

  @Post()
  create(@Body(new ZodValidationPipe(createTopicSchema)) body: CreateTopicBody): Promise<Topic> {
    return this.topics.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', contentIdPipe) id: string,
    @Body(new ZodValidationPipe(updateTopicSchema)) body: UpdateTopicBody,
  ): Promise<Topic> {
    return this.topics.update(id, body);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('id', contentIdPipe) id: string,
    @CurrentUser() actor: User,
    @RequestId() requestId: string,
  ): Promise<Topic> {
    return this.topics.setStatus(id, 'published', actor, requestId);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(
    @Param('id', contentIdPipe) id: string,
    @CurrentUser() actor: User,
    @RequestId() requestId: string,
  ): Promise<Topic> {
    return this.topics.setStatus(id, 'draft', actor, requestId);
  }

  @Delete(':id')
  remove(@Param('id', contentIdPipe) id: string): Promise<{ id: string; deletedAt: string }> {
    return this.topics.softDelete(id);
  }

  @Get(':id/context')
  context(@Param('id', contentIdPipe) id: string): Promise<TopicContextView> {
    return this.topics.context(id);
  }
}
