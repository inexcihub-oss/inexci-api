import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/database/entities/user.entity';
import { PatientsService } from './patients.service';
import { PatientsController } from './patients.controller';
import { UserRepository } from 'src/database/repositories/user.repository';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  controllers: [PatientsController],
  providers: [PatientsService, UserRepository],
})
export class PatientsModule {}
