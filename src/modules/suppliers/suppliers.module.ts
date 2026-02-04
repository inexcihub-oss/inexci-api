import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from 'src/database/entities/supplier.entity';
import { User } from 'src/database/entities/user.entity';
import { DoctorProfile } from 'src/database/entities/doctor-profile.entity';
import { TeamMember } from 'src/database/entities/team-member.entity';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { SupplierRepository } from 'src/database/repositories/supplier.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { TeamMemberRepository } from 'src/database/repositories/team-member.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([Supplier, User, DoctorProfile, TeamMember]),
  ],
  controllers: [SuppliersController],
  providers: [
    SuppliersService,
    SupplierRepository,
    DoctorProfileRepository,
    UserRepository,
    TeamMemberRepository,
  ],
})
export class SuppliersModule {}
