import { Controller, Get, Query, Request } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { FindManyPatientDto } from './dto/find-many-patient.dto';

@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  findAll(@Query() query: FindManyPatientDto, @Request() req) {
    return this.patientsService.findAll(query, req.user.userId);
  }
}
