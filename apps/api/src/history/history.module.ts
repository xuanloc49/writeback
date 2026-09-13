import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RewriteModule } from '../rewrite/rewrite.module';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  imports: [AuthModule, RewriteModule],
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
