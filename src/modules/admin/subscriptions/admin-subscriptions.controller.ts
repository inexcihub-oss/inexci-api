import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import {
  AdminSubscriptionActionResultDto,
  ExtendTrialDto,
  GrantInternalAccessDto,
  RevokeInternalAccessDto,
} from './dto/admin-subscription-actions.dto';
import {
  CurrentAdmin,
  PlatformAdminOnly,
} from '../auth/platform-admin-only.decorator';
import { AuthenticatedAdmin } from '../auth/admin-session.guard';

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin/accounts')
export class AdminSubscriptionsController {
  constructor(private readonly service: AdminSubscriptionsService) {}

  @Post(':ownerId/subscription/extend-trial')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Estende o trial (Stripe primeiro quando a assinatura lá está em trial)',
  })
  @ApiOkResponse({ type: AdminSubscriptionActionResultDto })
  @ApiBadRequestResponse({
    description: 'Motivo, days/until ou limites inválidos',
  })
  @ApiNotFoundResponse({ description: 'Conta não encontrada' })
  @ApiConflictResponse({
    description: 'Situação da conta não permite estender',
  })
  @ApiServiceUnavailableResponse({ description: 'Stripe não respondeu' })
  extendTrial(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: ExtendTrialDto,
  ): Promise<AdminSubscriptionActionResultDto> {
    return this.service.extendTrial(ownerId, admin.adminId, dto);
  }

  @Post(':ownerId/subscription/grant-internal-access')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Dá acesso interno (sem limite e sem cobrança) a conta sem assinatura viva na Stripe',
  })
  @ApiOkResponse({ type: AdminSubscriptionActionResultDto })
  @ApiBadRequestResponse({ description: 'Motivo inválido' })
  @ApiNotFoundResponse({ description: 'Conta não encontrada' })
  @ApiConflictResponse({
    description: 'Conta com assinatura na Stripe ou já com acesso interno',
  })
  @ApiServiceUnavailableResponse({
    description: 'Stripe não respondeu; nada foi alterado',
  })
  grantInternalAccess(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: GrantInternalAccessDto,
  ): Promise<AdminSubscriptionActionResultDto> {
    return this.service.grantInternalAccess(ownerId, admin.adminId, dto);
  }

  @Post(':ownerId/subscription/revoke-internal-access')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Encerra o acesso interno: volta para trial de N dias ou cancela',
  })
  @ApiOkResponse({ type: AdminSubscriptionActionResultDto })
  @ApiBadRequestResponse({
    description: 'Motivo, destino ou trialDays inválidos',
  })
  @ApiNotFoundResponse({ description: 'Conta não encontrada' })
  @ApiConflictResponse({ description: 'A conta não tem acesso interno' })
  revokeInternalAccess(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: RevokeInternalAccessDto,
  ): Promise<AdminSubscriptionActionResultDto> {
    return this.service.revokeInternalAccess(ownerId, admin.adminId, dto);
  }
}
