import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import {
  RequireAnyArea,
  RequirePermission,
} from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';
import { ClinicsService } from './clinics.service';
import { CreateClinicDto } from './dto/create-clinic.dto';
import { UpdateClinicDto } from './dto/update-clinic.dto';
import { FindManyClinicDto } from './dto/find-many-clinic.dto';
import { BulkDeleteClinicsDto } from './dto/bulk-delete-clinics.dto';

@ApiTags('Clínicas')
@ApiBearerAuth()
@Controller('clinics')
// Cadastrar local de atendimento é ato de administração — diferente dos
// cadastros transversais (hospitais, convênios), que qualquer área cria.
// Mas a LEITURA abre em `@RequireAnyArea()`: quem só tem Agenda precisa da
// lista para escolher a unidade da consulta e para o aviso de "fora do
// horário". Exceção deliberada; não "corrija" fechando os GETs.
@RequirePermission(Permission.ADMINISTRACAO)
export class ClinicsController {
  constructor(private readonly clinicsService: ClinicsService) {}

  @Get()
  @RequireAnyArea()
  @ApiOperation({ summary: 'Listar clínicas (locais de atendimento)' })
  findAll(
    @Query() query: FindManyClinicDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicsService.findAll(query, user.userId);
  }

  @Get(':id')
  @RequireAnyArea()
  @ApiOperation({ summary: 'Buscar clínica por ID' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicsService.findOne(id, user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar clínica' })
  @ApiResponse({ status: 201, description: 'Clínica criada' })
  create(
    @Body() data: CreateClinicDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicsService.create(data, user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar clínica (inclui a grade de horários)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateClinicDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicsService.update(id, data, user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir clínica (soft delete)' })
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicsService.delete(id, user.userId);
  }

  @Post('bulk-delete')
  @ApiOperation({ summary: 'Excluir clínicas em lote (soft delete)' })
  bulkDelete(
    @Body() data: BulkDeleteClinicsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicsService.bulkDelete(data.ids, user.userId);
  }
}
