import { Module } from '@nestjs/common';
import { ProceduresService } from './procedures.service';
import { ProceduresController } from './procedures.controller';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { ProcedureRepository } from 'src/database/repositories/procedure.repository';
import { SurgeryRequestProcedureRepository } from 'src/database/repositories/surgery-request-procedure.repository';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import { StatusUpdateRepository } from 'src/database/repositories/status-update.repository';

@Module({
  controllers: [ProceduresController],
  providers: [
    ProceduresService,
    ProcedureRepository,
    SurgeryRequestProcedureRepository,
    SurgeryRequestRepository,
    OpmeItemRepository,
    StatusUpdateRepository,
  ],
  exports: [ProceduresService],
})
export class ProceduresModule {}
