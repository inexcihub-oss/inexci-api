import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { PatientsService } from './patients.service';
import { FindManyPatientDto } from './dto/find-many-patient.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';

@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  findAll(@Query() query: FindManyPatientDto, @Request() req) {
    return this.patientsService.findAll(query, req.user.userId);
  }

  @Post()
  create(@Body() data: CreatePatientDto, @Request() req) {
    return this.patientsService.create(data, req.user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: UpdatePatientDto) {
    return this.patientsService.update(id, data);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.patientsService.delete(id);
  }
}
