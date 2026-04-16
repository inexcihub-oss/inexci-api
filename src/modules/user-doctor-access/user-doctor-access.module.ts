import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserDoctorAccess } from 'src/database/entities/user-doctor-access.entity';
import { User } from 'src/database/entities/user.entity';
import { DoctorProfile } from 'src/database/entities/doctor-profile.entity';
import { UserDoctorAccessService } from './user-doctor-access.service';
import { UserDoctorAccessController } from './user-doctor-access.controller';
@Module({
  imports: [TypeOrmModule.forFeature([UserDoctorAccess, User, DoctorProfile])],
  controllers: [UserDoctorAccessController],
  providers: [UserDoctorAccessService],
  exports: [UserDoctorAccessService],
})
export class UserDoctorAccessModule {}
