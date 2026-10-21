import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';
import { PaymentMethodConfigsService } from '../services/payment-method-configs.service';
import {
  PaymentMethodConfigDto,
  UpdatePaymentMethodConfigDto,
} from '../dto/payment-method-config.dto';
import { ownerIdDe } from '../utils/owner';

@ApiTags('Financeiro')
@ApiBearerAuth()
@Controller('finance/payment-methods')
@RequirePermission(Permission.FINANCEIRO)
export class PaymentMethodsController {
  constructor(private readonly configsService: PaymentMethodConfigsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar a configuração das formas de pagamento' })
  @ApiOkResponse({ type: PaymentMethodConfigDto, isArray: true })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentMethodConfigDto[]> {
    return this.configsService.list(ownerIdDe(user), user.userId);
  }

  @Put(':method')
  @ApiOperation({ summary: 'Configurar uma forma de pagamento' })
  @ApiParam({ name: 'method', enum: PaymentMethod, enumName: 'PaymentMethod' })
  @ApiOkResponse({ type: PaymentMethodConfigDto })
  update(
    @Param('method', new ParseEnumPipe(PaymentMethod)) method: PaymentMethod,
    @Body() dto: UpdatePaymentMethodConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentMethodConfigDto> {
    return this.configsService.update(
      ownerIdDe(user),
      user.userId,
      method,
      dto,
    );
  }
}
