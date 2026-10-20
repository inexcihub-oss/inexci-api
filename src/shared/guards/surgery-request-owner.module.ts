import { Global, Module } from '@nestjs/common';
import { SurgeryRequestOwnerGuard } from './surgery-request-owner.guard';

@Global()
@Module({
  providers: [SurgeryRequestOwnerGuard],
  exports: [SurgeryRequestOwnerGuard],
})
export class SurgeryRequestOwnerGuardModule {}
