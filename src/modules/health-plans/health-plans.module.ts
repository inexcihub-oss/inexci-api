import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { HealthPlansController } from './health-plans.controller';
import { HealthPlansService } from './health-plans.service';
@Module({
  imports: [TypeOrmModule.forFeature([HealthPlan])],
  controllers: [HealthPlansController],
  providers: [HealthPlansService],
})
export class HealthPlansModule {}
