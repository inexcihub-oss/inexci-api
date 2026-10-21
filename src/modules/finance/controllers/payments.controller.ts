import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import {
  CreateRefundDto,
  FindPaymentsDto,
  PaymentListResponseDto,
} from '../dto/payment.dto';
import { ReceivableDetailDto } from '../dto/receivable.dto';
import { PaymentsService } from '../services/payments.service';
import { RefundsService } from '../services/refunds.service';
import { ownerIdDe } from '../utils/owner';

@ApiTags('Financeiro')
@ApiBearerAuth()
@Controller('finance/payments')
@RequirePermission(Permission.FINANCEIRO)
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly refundsService: RefundsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar recebimentos' })
  @ApiOkResponse({ type: PaymentListResponseDto })
  findAll(
    @Query() query: FindPaymentsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentListResponseDto> {
    return this.paymentsService.findAll(ownerIdDe(user), query);
  }

  @Post(':id/refunds')
  @ApiOperation({ summary: 'Estornar pagamento (total ou parcial)' })
  @ApiOkResponse({ type: ReceivableDetailDto })
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRefundDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivableDetailDto> {
    return this.refundsService.refund(ownerIdDe(user), user.userId, id, dto);
  }
}
