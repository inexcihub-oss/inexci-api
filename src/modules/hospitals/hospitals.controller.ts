import {
  Body,
  Controller,
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
import { HospitalsService } from './hospitals.service';
import { FindManyHospitalDto } from './dto/find-many-hospital.dto';
import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';

@Controller('hospitals')
export class HospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  @Get()
  findAll(
    @Query() query: FindManyHospitalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hospitalsService.findAll(query, user.userId);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(
    @Body() data: CreateHospitalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hospitalsService.create(data, user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: UpdateHospitalDto) {
    return this.hospitalsService.update(id, data);
  }
}
