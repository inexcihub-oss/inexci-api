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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
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
import { BulkDeletePatientsDto } from './dto/bulk-delete-patients.dto';

@ApiTags('Pacientes')
@ApiBearerAuth()
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar pacientes' })
  findAll(
    @Query() query: FindManyPatientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patientsService.findAll(query, user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar paciente' })
  create(
    @Body() data: CreatePatientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patientsService.create(data, user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar paciente' })
  update(
    @Param('id') id: string,
    @Body() data: UpdatePatientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patientsService.update(id, data, user.userId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Excluir paciente' })
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientsService.delete(id, user.userId);
  }

  @Post('bulk-delete')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Excluir pacientes em lote' })
  bulkDelete(
    @Body() data: BulkDeletePatientsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patientsService.bulkDelete(data.ids, user.userId);
  }
}
