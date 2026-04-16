import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from 'src/shared/decorators/roles.decorator';
import { UserRole } from 'src/database/entities/user.entity';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';
import { PatientsService } from './patients.service';
import { FindManyPatientDto } from './dto/find-many-patient.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';

@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  findAll(
    @Query() query: FindManyPatientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patientsService.findAll(query, user.userId);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(
    @Body() data: CreatePatientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patientsService.create(data, user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: UpdatePatientDto) {
    return this.patientsService.update(id, data);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  delete(@Param('id') id: string) {
    return this.patientsService.delete(id);
  }
}
