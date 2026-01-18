import { Controller, Get, Query, Request } from '@nestjs/common';
import { HospitalsService } from './hospitals.service';
import { FindManyHospitalDto } from './dto/find-many-hospital.dto';

@Controller('hospitals')
export class HospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  @Get()
  findAll(@Query() query: FindManyHospitalDto, @Request() req) {
    return this.hospitalsService.findAll(query, req.user.userId);
  }
}
