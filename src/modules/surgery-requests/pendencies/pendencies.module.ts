import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PendenciesController } from './pendencies.controller';
import { PendencyValidatorService } from './pendency-validator.service';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SurgeryRequest])],
  controllers: [PendenciesController],
  providers: [PendencyValidatorService],
  exports: [PendencyValidatorService],
})
export class PendenciesModule {}
