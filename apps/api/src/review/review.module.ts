import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ClozeSourceService } from './cloze-source.service';
import { ReviewQueueService } from './review-queue.service';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

@Module({
  imports: [AuthModule, CatalogModule],
  controllers: [ReviewController],
  providers: [ReviewQueueService, ClozeSourceService, ReviewService],
  exports: [ReviewQueueService],
})
export class ReviewModule {}
