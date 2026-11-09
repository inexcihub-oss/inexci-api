import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedAdmin } from '../auth/admin-session.guard';
import {
  CurrentAdmin,
  PlatformAdminOnly,
} from '../auth/platform-admin-only.decorator';
import { AdminTeamService } from './admin-team.service';
import {
  CreatePlatformAdminDto,
  PlatformAdminActionResultDto,
  PlatformAdminMemberDto,
  ResetPlatformAdminAccessDto,
  RevokePlatformAdminDto,
} from './dto/admin-team.dto';

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin/team')
export class AdminTeamController {
  constructor(private readonly service: AdminTeamService) {}

  @Get()
  @ApiOperation({ summary: 'Administradores da plataforma' })
  @ApiOkResponse({ type: [PlatformAdminMemberDto] })
  list(): Promise<PlatformAdminMemberDto[]> {
    return this.service.list();
  }

  @Post()
  @ApiOperation({ summary: 'Convida um novo administrador da plataforma' })
  @ApiCreatedResponse({ type: PlatformAdminActionResultDto })
  @ApiBadRequestResponse({ description: 'Nome ou e-mail inválidos' })
  @ApiConflictResponse({ description: 'E-mail já cadastrado' })
  create(
    @Body() dto: CreatePlatformAdminDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<PlatformAdminActionResultDto> {
    return this.service.create(dto, admin.adminId);
  }

  @Post(':adminId/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoga o acesso de um administrador e derruba a sessão dele',
  })
  @ApiOkResponse({ type: PlatformAdminActionResultDto })
  @ApiBadRequestResponse({ description: 'Motivo inválido' })
  @ApiNotFoundResponse({ description: 'Administrador não encontrado' })
  @ApiConflictResponse({
    description:
      'Revogação do próprio acesso, de quem já está revogado ou do último administrador ativo',
  })
  revoke(
    @Param('adminId', ParseUUIDPipe) adminId: string,
    @Body() dto: RevokePlatformAdminDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<PlatformAdminActionResultDto> {
    return this.service.revoke(adminId, dto, admin.adminId);
  }

  @Post(':adminId/reset-access')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Zera senha e MFA, derruba as sessões e envia um novo convite ao administrador',
  })
  @ApiOkResponse({ type: PlatformAdminActionResultDto })
  @ApiBadRequestResponse({ description: 'Motivo inválido' })
  @ApiNotFoundResponse({ description: 'Administrador não encontrado' })
  @ApiConflictResponse({ description: 'Redefinição do próprio acesso' })
  resetAccess(
    @Param('adminId', ParseUUIDPipe) adminId: string,
    @Body() dto: ResetPlatformAdminAccessDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<PlatformAdminActionResultDto> {
    return this.service.resetAccess(adminId, dto, admin.adminId);
  }
}
