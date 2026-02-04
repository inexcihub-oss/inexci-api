import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Hospital } from 'src/database/entities/hospital.entity';
import { User } from 'src/database/entities/user.entity';
import { DoctorProfile } from 'src/database/entities/doctor-profile.entity';
import { HospitalsService } from './hospitals.service';
import { HospitalsController } from './hospitals.controller';
import { HospitalRepository } from 'src/database/repositories/hospital.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { UserRepository } from 'src/database/repositories/user.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Hospital, User, DoctorProfile])],
  controllers: [HospitalsController],
  providers: [
    HospitalsService,
    HospitalRepository,
    DoctorProfileRepository,
    UserRepository,
  ],
})
export class HospitalsModule {}
