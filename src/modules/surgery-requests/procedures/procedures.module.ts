import { Module } from '@nestjs/common';
import { ProceduresService } from './procedures.service';
import { ProceduresController } from './procedures.controller';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestTussItemRepository } from 'src/database/repositories/surgery-request-tuss-item.repository';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import { StatusUpdateRepository } from 'src/database/repositories/status-update.repository';

@Module({
  controllers: [ProceduresController],
  providers: [
    ProceduresService,
    SurgeryRequestTussItemRepository,
    SurgeryRequestRepository,
    OpmeItemRepository,
    StatusUpdateRepository,
  ],
  exports: [ProceduresService],
})
export class ProceduresModule {}
