import { Module } from '@nestjs/common';
import { ProceduresService } from './procedures.service';
import { ProceduresController } from './procedures.controller';
import { SurgeryRequestAccessValidator } from 'src/shared/services/surgery-request-access.validator';
@Module({
  controllers: [ProceduresController],
  providers: [ProceduresService, SurgeryRequestAccessValidator],
  exports: [ProceduresService],
})
export class ProceduresModule {}
