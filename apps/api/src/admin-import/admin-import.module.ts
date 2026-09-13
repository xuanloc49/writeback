import { Module } from '@nestjs/common';
import { AdminContentModule } from '../admin-content/admin-content.module';
import { AuthModule } from '../auth/auth.module';
import { AdminImportController } from './admin-import.controller';
import { AdminImportService } from './admin-import.service';
import { ImportValidatorService } from './import-validator.service';

/** `/v1/admin/import/*` — editor + admin (design §12.6, PRD Appendix A). */
@Module({
  imports: [AuthModule, AdminContentModule],
  controllers: [AdminImportController],
  providers: [AdminImportService, ImportValidatorService],
})
export class AdminImportModule {}
