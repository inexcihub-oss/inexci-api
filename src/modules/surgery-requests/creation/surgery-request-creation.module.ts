import { Module } from '@nestjs/common';
import { SurgeryRequestFromIndicationService } from './surgery-request-from-indication.service';

@Module({
  providers: [SurgeryRequestFromIndicationService],
  exports: [SurgeryRequestFromIndicationService],
})
export class SurgeryRequestCreationModule {}
