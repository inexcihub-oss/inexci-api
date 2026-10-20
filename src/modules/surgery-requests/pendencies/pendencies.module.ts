import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PendenciesController } from './pendencies.controller';
import { PendencyValidatorService } from './pendency-validator.service';
import { ReportSection } from 'src/database/entities/report-section.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ReportSection])],
  controllers: [PendenciesController],
  providers: [PendencyValidatorService],
  exports: [PendencyValidatorService],
})
export class PendenciesModule {}
