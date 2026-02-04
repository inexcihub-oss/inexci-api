import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from 'src/database/entities/supplier.entity';
import { User } from 'src/database/entities/user.entity';
import { DoctorProfile } from 'src/database/entities/doctor-profile.entity';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { SupplierRepository } from 'src/database/repositories/supplier.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { UserRepository } from 'src/database/repositories/user.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Supplier, User, DoctorProfile])],
  controllers: [SuppliersController],
  providers: [
    SuppliersService,
    SupplierRepository,
    DoctorProfileRepository,
    UserRepository,
  ],
})
export class SuppliersModule {}
