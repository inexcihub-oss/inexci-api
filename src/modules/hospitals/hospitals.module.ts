import { Module } from '@nestjs/common';
import { HospitalsService } from './hospitals.service';
import { HospitalsController } from './hospitals.controller';
import { AuthModule } from '../auth/auth.module';
import { UserRepository } from 'src/database/repositories/user.repository';

@Module({
  imports: [AuthModule],
  controllers: [HospitalsController],
  providers: [HospitalsService, UserRepository],
})
export class HospitalsModule {}
