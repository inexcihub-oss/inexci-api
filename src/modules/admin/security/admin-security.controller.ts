import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformAdminOnly } from '../auth/platform-admin-only.decorator';
import { AdminSecurityService } from './admin-security.service';
import {
  AdminAccountSecurityDto,
  AdminAccountSecurityLogsDto,
  AdminSecurityOverviewDto,
  AdminSecurityQueryDto,
} from './dto/admin-security.dto';

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin')
export class AdminSecurityController {
  constructor(private readonly service: AdminSecurityService) {}

  @Get('security')
  @ApiOperation({
    summary:
      'Eventos de segurança: totais, série diária, picos de falha de login e contas com reuso de token',
  })
  @ApiOkResponse({ type: AdminSecurityOverviewDto })
  overview(
    @Query() query: AdminSecurityQueryDto,
  ): Promise<AdminSecurityOverviewDto> {
    return this.service.overview(query);
  }

  @Get('accounts/:ownerId/security')
  @ApiOperation({ summary: 'Eventos de segurança de uma conta, por usuário' })
  @ApiOkResponse({ type: AdminAccountSecurityDto })
  forAccount(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Query() query: AdminSecurityQueryDto,
  ): Promise<AdminAccountSecurityDto> {
    return this.service.forAccount(ownerId, query);
  }

  @Get('accounts/:ownerId/security/logs')
  @ApiOperation({
    summary:
      'Linhas de log de autenticação da conta no Grafana (Loki), com IP mascarado',
  })
  @ApiOkResponse({ type: AdminAccountSecurityLogsDto })
  logs(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Query() query: AdminSecurityQueryDto,
  ): Promise<AdminAccountSecurityLogsDto> {
    return this.service.logsForAccount(ownerId, query);
  }
}
