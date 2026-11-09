import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminActionReasonDto } from '../subscriptions/dto/admin-subscription-actions.dto';
import { AdminCouponsService } from './admin-coupons.service';
import {
  AdminCouponActionResultDto,
  AdminCouponListResponseDto,
  AdminCouponRedemptionsResponseDto,
  CreateCouponDto,
} from './dto/admin-coupons.dto';
import {
  CurrentAdmin,
  PlatformAdminOnly,
} from '../auth/platform-admin-only.decorator';
import { AuthenticatedAdmin } from '../auth/admin-session.guard';

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin/coupons')
export class AdminCouponsController {
  constructor(private readonly service: AdminCouponsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Lista os códigos promocionais da Stripe (até 100) com usos, validade e situação',
  })
  @ApiOkResponse({ type: AdminCouponListResponseDto })
  @ApiServiceUnavailableResponse({ description: 'Stripe não respondeu' })
  list(): Promise<AdminCouponListResponseDto> {
    return this.service.list();
  }

  @Post()
  @ApiOperation({
    summary: 'Cria o cupom e o código promocional na Stripe (Stripe primeiro)',
  })
  @ApiCreatedResponse({ type: AdminCouponActionResultDto })
  @ApiBadRequestResponse({ description: 'Regras do cupom ou planos inválidos' })
  @ApiConflictResponse({ description: 'Código já existe na Stripe' })
  @ApiBadGatewayResponse({ description: 'A Stripe falhou' })
  @ApiServiceUnavailableResponse({
    description: 'Stripe não respondeu; nada foi alterado',
  })
  create(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: CreateCouponDto,
  ): Promise<AdminCouponActionResultDto> {
    return this.service.create(admin.adminId, dto);
  }

  @Get(':id/redemptions')
  @ApiOperation({
    summary:
      'Contas que usaram o código (faturas espelhadas e desconto da assinatura)',
  })
  @ApiOkResponse({ type: AdminCouponRedemptionsResponseDto })
  @ApiNotFoundResponse({ description: 'Cupom não encontrado' })
  redemptions(
    @Param('id') id: string,
  ): Promise<AdminCouponRedemptionsResponseDto> {
    return this.service.redemptions(id);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Desativa o código promocional; quem já usou mantém o desconto vigente',
  })
  @ApiOkResponse({ type: AdminCouponActionResultDto })
  @ApiBadRequestResponse({ description: 'Motivo inválido' })
  @ApiNotFoundResponse({ description: 'Cupom não encontrado' })
  @ApiConflictResponse({ description: 'Cupom já desativado' })
  @ApiServiceUnavailableResponse({
    description: 'Stripe não respondeu; nada foi alterado',
  })
  deactivate(
    @Param('id') id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: AdminActionReasonDto,
  ): Promise<AdminCouponActionResultDto> {
    return this.service.deactivate(id, admin.adminId, dto.reason);
  }
}
