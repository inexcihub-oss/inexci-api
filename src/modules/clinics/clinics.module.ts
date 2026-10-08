import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clinic } from 'src/database/entities/clinic.entity';
import { ClinicsService } from './clinics.service';
import { ClinicsController } from './clinics.controller';
import { ClinicRoomsService } from './clinic-rooms.service';

@Module({
  imports: [TypeOrmModule.forFeature([Clinic])],
  controllers: [ClinicsController],
  providers: [ClinicsService, ClinicRoomsService],
  exports: [ClinicsService],
})
export class ClinicsModule {}
