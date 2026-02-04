import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { User } from 'src/database/entities/user.entity';
import { DoctorProfile } from 'src/database/entities/doctor-profile.entity';
import { HealthPlansController } from './health_plans.controller';
import { HealthPlansService } from './health_plans_service';
import { HealthPlanRepository } from 'src/database/repositories/health-plan.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { UserRepository } from 'src/database/repositories/user.repository';

@Module({
  imports: [TypeOrmModule.forFeature([HealthPlan, User, DoctorProfile])],
  controllers: [HealthPlansController],
  providers: [
    HealthPlansService,
    HealthPlanRepository,
    DoctorProfileRepository,
    UserRepository,
  ],
})
export class HealthPlansModule {}
