import { Module } from '@nestjs/common';
import { OpmeService } from './opme.service';
import { OpmeController } from './opme.controller';
import { SurgeryRequestAccessValidator } from 'src/shared/services/surgery-request-access.validator';

@Module({
  controllers: [OpmeController],
  providers: [OpmeService, SurgeryRequestAccessValidator],
  exports: [OpmeService],
})
export class OpmeModule {}
