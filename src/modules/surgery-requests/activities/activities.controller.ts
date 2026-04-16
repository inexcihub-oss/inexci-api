import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@Controller('surgery-requests/:id/activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  findAll(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.activitiesService.findAll(id, user.userId);
  }

  @Post()
  create(
    @Param('id') id: string,
    @Body() dto: CreateActivityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.create(id, dto, user.userId);
  }
}
