import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedAdmin } from '../auth/admin-session.guard';
import {
  CurrentAdmin,
  PlatformAdminOnly,
} from '../auth/platform-admin-only.decorator';
import { AdminClinicalAccessService } from './admin-clinical-access.service';
import {
  AdminClinicalAccessDto,
  AdminClinicalAccessExportDto,
  AdminClinicalAccessExportResultDto,
  AdminClinicalAccessPatientDto,
  AdminClinicalAccessPatientResultDto,
  AdminClinicalAccessQueryDto,
} from './dto/admin-clinical-access.dto';

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin/accounts/:ownerId/clinical-access')
export class AdminClinicalAccessController {
  constructor(private readonly service: AdminClinicalAccessService) {}

  @Get()
  @ApiOperation({
    summary:
      'Volume de acessos a prontuário da conta (LGPD), com o paciente só por código anônimo',
  })
  @ApiOkResponse({ type: AdminClinicalAccessDto })
  forAccount(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Query() query: AdminClinicalAccessQueryDto,
  ): Promise<AdminClinicalAccessDto> {
    return this.service.forAccount(ownerId, query.days);
  }

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Exporta o volume de acessos a prontuário por usuário, com motivo e auditoria',
  })
  @ApiOkResponse({ type: AdminClinicalAccessExportResultDto })
  @ApiBadRequestResponse({ description: 'Motivo ou período inválido' })
  export(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: AdminClinicalAccessExportDto,
  ): Promise<AdminClinicalAccessExportResultDto> {
    return this.service.export(
      ownerId,
      { reason: dto.reason, days: dto.days },
      admin.adminId,
    );
  }

  @Post('patient')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Acessos ao prontuário de um paciente (código anônimo ou id), com motivo e auditoria',
  })
  @ApiOkResponse({ type: AdminClinicalAccessPatientResultDto })
  @ApiBadRequestResponse({
    description: 'Motivo, paciente ou período inválido',
  })
  forPatient(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: AdminClinicalAccessPatientDto,
  ): Promise<AdminClinicalAccessPatientResultDto> {
    return this.service.forPatient(
      ownerId,
      { reason: dto.reason, patient: dto.patient, days: dto.days },
      admin.adminId,
    );
  }
}
