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
import { HospitalsService } from './hospitals.service';
import { FindManyHospitalDto } from './dto/find-many-hospital.dto';
import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { BulkDeleteHospitalsDto } from './dto/bulk-delete-hospitals.dto';

@ApiTags('Hospitais')
@ApiBearerAuth()
@Controller('hospitals')
// Cadastro transversal às quatro áreas: `@RequireAnyArea()` exige ao menos
// uma área (fail-closed p/ colaborador sem permissão) sem amarrar a uma
// específica. Criar e atualizar herdam essa regra: quem monta a solicitação
// ou marca a consulta precisa cadastrar o hospital que faltou, sem depender do
// admin. Só `delete`/`bulkDelete` seguem em `ADMINISTRACAO` — apagar um
// hospital afeta solicitações que já o referenciam.
@RequireAnyArea()
export class HospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar hospitais' })
  findAll(
    @Query() query: FindManyHospitalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hospitalsService.findAll(query, user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar hospital' })
  @ApiResponse({ status: 201, description: 'Hospital criado' })
  create(
    @Body() data: CreateHospitalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hospitalsService.create(data, user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar hospital' })
  update(
    @Param('id') id: string,
    @Body() data: UpdateHospitalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hospitalsService.update(id, data, user.userId);
  }

  @Delete(':id')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Excluir hospital (soft delete)' })
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.hospitalsService.delete(id, user.userId);
  }

  @Post('bulk-delete')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Excluir hospitais em lote (soft delete)' })
  bulkDelete(
    @Body() data: BulkDeleteHospitalsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hospitalsService.bulkDelete(data.ids, user.userId);
  }
}
