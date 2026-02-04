import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Patient } from 'src/database/entities/patient.entity';
import { User } from 'src/database/entities/user.entity';
import { DoctorProfile } from 'src/database/entities/doctor-profile.entity';
import { PatientsService } from './patients.service';
import { PatientsController } from './patients.controller';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { UserRepository } from 'src/database/repositories/user.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Patient, User, DoctorProfile])],
  controllers: [PatientsController],
  providers: [
    PatientsService,
    PatientRepository,
    DoctorProfileRepository,
    UserRepository,
  ],
})
export class PatientsModule {}
