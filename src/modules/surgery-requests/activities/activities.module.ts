import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SurgeryRequestActivity } from 'src/database/entities/surgery-request-activity.entity';
import { SurgeryRequestActivityRepository } from 'src/database/repositories/surgery-request-activity.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { ActivitiesService } from './activities.service';
import { ActivitiesController } from './activities.controller';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { User } from 'src/database/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([SurgeryRequestActivity, SurgeryRequest, User]),
  ],
  controllers: [ActivitiesController],
  providers: [
    ActivitiesService,
    SurgeryRequestActivityRepository,
    SurgeryRequestRepository,
    UserRepository,
  ],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
