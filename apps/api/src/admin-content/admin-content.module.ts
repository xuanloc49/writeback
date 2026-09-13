import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LemmasController } from './lemmas.controller';
import { LemmasService } from './lemmas.service';
import { PromptsController } from './prompts.controller';
import { PromptsService } from './prompts.service';
import { TopicsController } from './topics.controller';
import { TopicsService } from './topics.service';

/** `/v1/admin/{topics,lemmas,prompts}` — editor + admin (design §12.6). */
@Module({
  imports: [AuthModule],
  controllers: [TopicsController, LemmasController, PromptsController],
  providers: [TopicsService, LemmasService, PromptsService],
  exports: [LemmasService, PromptsService],
})
export class AdminContentModule {}
