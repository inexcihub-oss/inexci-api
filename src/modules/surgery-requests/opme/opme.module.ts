import { Module } from '@nestjs/common';
import { OpmeService } from './opme.service';
import { OpmeController } from './opme.controller';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import { SurgeryRequestsModule } from '../surgery-requests.module';

@Module({
  imports: [SurgeryRequestsModule],
  controllers: [OpmeController],
  providers: [OpmeService, OpmeItemRepository],
  exports: [OpmeService],
})
export class OpmeModule {}
