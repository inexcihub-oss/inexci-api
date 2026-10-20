import { Global, Module } from '@nestjs/common';
import { ClinicalAccessAuditService } from './clinical-access-audit.service';

@Global()
@Module({
  providers: [ClinicalAccessAuditService],
  exports: [ClinicalAccessAuditService],
})
export class ClinicalAccessAuditModule {}
