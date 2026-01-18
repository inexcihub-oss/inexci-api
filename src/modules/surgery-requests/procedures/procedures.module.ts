import { Module } from '@nestjs/common';
import { ProceduresService } from './procedures.service';
import { ProceduresController } from './procedures.controller';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { ProcedureRepository } from 'src/database/repositories/procedure.repository';
import { SurgeryRequestProcedureRepository } from 'src/database/repositories/surgery-request-procedure.repository';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import { PendenciesModule } from '../pendencies/pendencies.module';
import { PendenciesService } from '../pendencies/pendencies.service';
import { PendencyRepository } from 'src/database/repositories/pendency.repository';

@Module({
  imports: [PendenciesModule],
  controllers: [ProceduresController],
  providers: [
    ProceduresService,
    ProcedureRepository,
    SurgeryRequestProcedureRepository,
    SurgeryRequestRepository,
    OpmeItemRepository,
    PendenciesService,
    PendencyRepository,
  ],
  exports: [ProceduresService],
})
export class ProceduresModule {}
