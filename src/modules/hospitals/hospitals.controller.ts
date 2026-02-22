import { Body, Controller, Get, Post, Query, Request } from '@nestjs/common';
import { HospitalsService } from './hospitals.service';
import { FindManyHospitalDto } from './dto/find-many-hospital.dto';
import { CreateHospitalDto } from './dto/create-hospital.dto';

@Controller('hospitals')
export class HospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  @Get()
  findAll(@Query() query: FindManyHospitalDto, @Request() req) {
    return this.hospitalsService.findAll(query, req.user.userId);
  }

  @Post()
  create(@Body() data: CreateHospitalDto, @Request() req) {
    return this.hospitalsService.create(data, req.user.userId);
  }
}
