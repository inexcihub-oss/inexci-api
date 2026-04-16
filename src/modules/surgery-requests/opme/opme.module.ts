import { Module } from '@nestjs/common';
import { OpmeService } from './opme.service';
import { OpmeController } from './opme.controller';
import { SurgeryRequestsModule } from '../surgery-requests.module';

@Module({
  imports: [SurgeryRequestsModule],
  controllers: [OpmeController],
  providers: [OpmeService],
  exports: [OpmeService],
})
export class OpmeModule {}
