import { Module } from '@nestjs/common';
import { PendenciesController } from './pendencies.controller';
import { PendencyValidatorService } from './pendency-validator.service';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { UsersModule } from 'src/modules/users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [PendenciesController],
  providers: [PendencyValidatorService, SurgeryRequestRepository],
  exports: [PendencyValidatorService],
})
export class PendenciesModule {}
