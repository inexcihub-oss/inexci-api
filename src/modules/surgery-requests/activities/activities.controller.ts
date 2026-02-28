import { Controller, Get, Post, Body, Param, Request } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { CreateActivityDto } from './dto/create-activity.dto';

@Controller('surgery-requests/:id/activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  findAll(@Param('id') id: string, @Request() req) {
    return this.activitiesService.findAll(id, req.user.userId);
  }

  @Post()
  create(
    @Param('id') id: string,
    @Body() dto: CreateActivityDto,
    @Request() req,
  ) {
    return this.activitiesService.create(id, dto, req.user.userId);
  }
}
