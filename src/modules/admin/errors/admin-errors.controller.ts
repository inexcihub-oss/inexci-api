import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformAdminOnly } from '../auth/platform-admin-only.decorator';
import { AdminErrorsService } from './admin-errors.service';
import { FingerprintPipe } from './fingerprint.pipe';
import {
  AdminAccountErrorsDto,
  AdminErrorOccurrencesDto,
  AdminErrorOccurrencesQueryDto,
  AdminErrorsOverviewDto,
  AdminErrorsQueryDto,
} from './dto/admin-errors.dto';

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin')
export class AdminErrorsController {
  constructor(private readonly service: AdminErrorsService) {}

  @Get('errors')
  @ApiOperation({
    summary:
      'Erros da plataforma: totais, série diária, erros mais frequentes e contas mais afetadas',
  })
  @ApiOkResponse({ type: AdminErrorsOverviewDto })
  overview(
    @Query() query: AdminErrorsQueryDto,
  ): Promise<AdminErrorsOverviewDto> {
    return this.service.overview(query);
  }

  @Get('accounts/:ownerId/errors')
  @ApiOperation({ summary: 'Erros de uma conta cliente' })
  @ApiOkResponse({ type: AdminAccountErrorsDto })
  forAccount(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Query() query: AdminErrorsQueryDto,
  ): Promise<AdminAccountErrorsDto> {
    return this.service.forAccount(ownerId, query);
  }

  @Get('errors/:fingerprint/occurrences')
  @ApiOperation({
    summary:
      'Ocorrências recentes de um erro, com as linhas de log do Grafana (Loki) quando configurado',
  })
  @ApiOkResponse({ type: AdminErrorOccurrencesDto })
  occurrences(
    @Param('fingerprint', FingerprintPipe) fingerprint: string,
    @Query() query: AdminErrorOccurrencesQueryDto,
  ): Promise<AdminErrorOccurrencesDto> {
    return this.service.occurrences(fingerprint, query);
  }
}
