import { Module } from '@nestjs/common';
import { OpmeService } from './opme.service';
import { OpmeController } from './opme.controller';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import { SurgeryRequestsModule } from '../surgery-requests.module';
import { PendenciesModule } from '../pendencies/pendencies.module';
import { PendenciesService } from '../pendencies/pendencies.service';
import { PendencyRepository } from 'src/database/repositories/pendency.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';

@Module({
  imports: [SurgeryRequestsModule, PendenciesModule],
  controllers: [OpmeController],
  providers: [
    OpmeService,
    OpmeItemRepository,
    PendenciesService,
    PendencyRepository,
  ],
  exports: [OpmeService],
})
export class OpmeModule {}
