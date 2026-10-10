import { Module } from '@nestjs/common';
import { ProceduresService } from './procedures.service';
import { SurgeryRequestProceduresController } from './procedures.controller';
import { SurgeryRequestAccessValidator } from 'src/shared/services/surgery-request-access.validator';
@Module({
  controllers: [SurgeryRequestProceduresController],
  providers: [ProceduresService, SurgeryRequestAccessValidator],
  exports: [ProceduresService],
})
export class ProceduresModule {}
