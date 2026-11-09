import {
  BadRequestException,
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
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminAccountStatusService } from './admin-account-status.service';
import {
  AccountStatusActionDto,
  AdminAccountStatusResultDto,
} from './dto/admin-account-status.dto';
import { AuthenticatedAdmin } from '../auth/admin-session.guard';
import { AdminAccountsService } from './admin-accounts.service';
import { ListAdminAccountsQueryDto } from './dto/list-admin-accounts-query.dto';
import { AdminAccountDetailQueryDto } from './dto/admin-account-detail-query.dto';
import {
  AdminAccountDetailDto,
  AdminAccountListResponseDto,
  AdminAccountSubscriptionDto,
  AdminTeamResponseDto,
} from './dto/admin-account-response.dto';
import { AdminTeamQueryDto } from './dto/admin-team-query.dto';
import { AdminActivationService } from '../activation/admin-activation.service';
import { AdminAccountActivationDto } from '../activation/dto/admin-activation.dto';
import {
  CurrentAdmin,
  PlatformAdminOnly,
} from '../auth/platform-admin-only.decorator';

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin/accounts')
export class AdminAccountsController {
  constructor(
    private readonly service: AdminAccountsService,
    private readonly status: AdminAccountStatusService,
    private readonly activationService: AdminActivationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista as contas cliente com situação e uso' })
  @ApiOkResponse({ type: AdminAccountListResponseDto })
  list(
    @Query() query: ListAdminAccountsQueryDto,
  ): Promise<AdminAccountListResponseDto> {
    return this.service.list(query);
  }

  @Get(':ownerId')
  @ApiOperation({ summary: 'Detalhe de uma conta cliente com o uso agregado' })
  @ApiOkResponse({ type: AdminAccountDetailDto })
  detail(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Query() query: AdminAccountDetailQueryDto,
  ): Promise<AdminAccountDetailDto> {
    if (query.from && query.to && query.to <= query.from) {
      throw new BadRequestException('"to" deve ser posterior a "from"');
    }
    return this.service.getDetail(ownerId, query);
  }

  @Get(':ownerId/team')
  @ApiOperation({
    summary:
      'Equipe da conta com acesso, consentimentos, onboarding e uso no período (telefone mascarado, sem CPF)',
  })
  @ApiOkResponse({ type: AdminTeamResponseDto })
  team(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Query() query: AdminTeamQueryDto,
  ): Promise<AdminTeamResponseDto> {
    return this.service.getTeam(ownerId, query.days ?? 30);
  }

  @Get(':ownerId/activation')
  @ApiOperation({
    summary: 'Marcos de ativação e andamento do onboarding da conta',
  })
  @ApiOkResponse({ type: AdminAccountActivationDto })
  @ApiNotFoundResponse({ description: 'Conta não encontrada' })
  activation(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
  ): Promise<AdminAccountActivationDto> {
    return this.activationService.getAccountActivation(ownerId);
  }

  @Get(':ownerId/subscription')
  @ApiOperation({
    summary: 'Assinatura da conta: banco mais leitura ao vivo da Stripe',
  })
  @ApiOkResponse({ type: AdminAccountSubscriptionDto })
  subscription(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
  ): Promise<AdminAccountSubscriptionDto> {
    return this.service.getSubscription(ownerId);
  }

  @Post(':ownerId/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Desativa a conta: ninguém da clínica entra e as sessões caem na hora',
  })
  @ApiOkResponse({ type: AdminAccountStatusResultDto })
  @ApiBadRequestResponse({ description: 'Motivo inválido' })
  @ApiNotFoundResponse({ description: 'Conta não encontrada' })
  @ApiConflictResponse({
    description: 'Conta já desativada ou com cobrança ativa na Stripe',
  })
  @ApiServiceUnavailableResponse({
    description: 'Stripe não respondeu; nada foi alterado',
  })
  deactivate(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: AccountStatusActionDto,
  ): Promise<AdminAccountStatusResultDto> {
    return this.status.deactivate(ownerId, admin.adminId, dto.reason);
  }

  @Post(':ownerId/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reativa uma conta desativada pelo painel' })
  @ApiOkResponse({ type: AdminAccountStatusResultDto })
  @ApiBadRequestResponse({ description: 'Motivo inválido' })
  @ApiNotFoundResponse({ description: 'Conta não encontrada' })
  @ApiConflictResponse({ description: 'A conta não está desativada' })
  reactivate(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: AccountStatusActionDto,
  ): Promise<AdminAccountStatusResultDto> {
    return this.status.reactivate(ownerId, admin.adminId, dto.reason);
  }
}
