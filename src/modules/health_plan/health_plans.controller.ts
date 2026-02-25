import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { HealthPlansService } from './health_plans_service';
import { FindManyHealthPlanDto } from './dto/find-many-health-plan.dto';
import { CreateHealthPlanDto } from './dto/create-health-plan.dto';
import { UpdateHealthPlanDto } from './dto/update-health-plan.dto';

@Controller('health_plans')
export class HealthPlansController {
  constructor(private readonly healthPlansService: HealthPlansService) {}

  @Get()
  findAll(@Query() query: FindManyHealthPlanDto, @Request() req) {
    return this.healthPlansService.findAll(query, req.user.userId);
  }

  @Post()
  create(@Body() data: CreateHealthPlanDto, @Request() req) {
    return this.healthPlansService.create(data, req.user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: UpdateHealthPlanDto) {
    return this.healthPlansService.update(id, data);
  }
}
