import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Global so any admin/support module can inject `AuditService` without importing this module. */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
