import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { DoctorSchedulesService } from './doctor-schedules.service';
import { HolidaysService } from './holidays.service';
import { ScheduleBlocksService } from './schedule-blocks.service';

@Module({
  controllers: [AvailabilityController],
  providers: [
    AvailabilityService,
    DoctorSchedulesService,
    ScheduleBlocksService,
    HolidaysService,
  ],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
