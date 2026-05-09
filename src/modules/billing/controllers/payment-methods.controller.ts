import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import { PaymentMethodService } from '../services/payment-method.service';
import { SavePaymentMethodDto } from '../dto/save-payment-method.dto';

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing/payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}

  @Get()
  @ApiOperation({ summary: 'Listar cart\u00f5es do admin logado' })
  async list(@CurrentUser() user: AuthenticatedUser) {
    const cards = await this.paymentMethodService.listMine(user.userId);
    return cards.map((c) => ({
      id: c.id,
      brand: c.brand,
      last4: c.last4,
      holderName: c.holderName,
      expMonth: c.expMonth,
      expYear: c.expYear,
      isDefault: c.isDefault,
      createdAt: c.createdAt,
    }));
  }

  @Post()
  @ApiOperation({ summary: 'Cadastrar/atualizar cart\u00e3o de cr\u00e9dito' })
  async add(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SavePaymentMethodDto,
    @Ip() ip: string,
    @Headers('x-forwarded-for') xff?: string,
  ) {
    const remoteIp = (xff?.split(',')[0]?.trim() || ip || '0.0.0.0').replace(
      /^::ffff:/,
      '',
    );
    const saved = await this.paymentMethodService.addCard(
      user.userId,
      dto,
      remoteIp,
    );
    return {
      id: saved.id,
      brand: saved.brand,
      last4: saved.last4,
      holderName: saved.holderName,
      expMonth: saved.expMonth,
      expYear: saved.expYear,
      isDefault: saved.isDefault,
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover cart\u00e3o' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.paymentMethodService.removeCard(user.userId, id);
    return { ok: true };
  }
}
