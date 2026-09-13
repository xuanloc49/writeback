import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AutoAddService } from './auto-add.service';
import { VocabController } from './vocab.controller';

@Module({
  imports: [AuthModule, CatalogModule],
  controllers: [VocabController],
  providers: [AutoAddService],
  exports: [AutoAddService],
})
export class VocabModule {}
