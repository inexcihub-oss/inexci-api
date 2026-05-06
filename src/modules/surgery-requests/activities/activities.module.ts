import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SurgeryRequestActivity } from 'src/database/entities/surgery-request-activity.entity';
import { ActivitiesService } from './activities.service';
import { ActivitiesController } from './activities.controller';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { User } from 'src/database/entities/user.entity';
import { StorageService } from 'src/shared/storage/storage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SurgeryRequestActivity, SurgeryRequest, User]),
  ],
  controllers: [ActivitiesController],
  providers: [ActivitiesService, StorageService],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
