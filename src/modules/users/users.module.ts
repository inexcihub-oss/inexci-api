import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/database/entities/user.entity';
import { TeamMember } from 'src/database/entities/team-member.entity';
import { DoctorProfile } from 'src/database/entities/doctor-profile.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { TeamMemberRepository } from 'src/database/repositories/team-member.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { EmailService } from 'src/shared/email/email.service';
import { JwtService } from '@nestjs/jwt';
import { StorageModule } from 'src/shared/storage/storage.module';
import { StorageService } from 'src/shared/storage/storage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, TeamMember, DoctorProfile]),
    StorageModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    UserRepository,
    TeamMemberRepository,
    DoctorProfileRepository,
    EmailService,
    JwtService,
    StorageService,
  ],
  exports: [UsersService],
})
export class UsersModule {}
