import {
  Body,
  Controller,
  Delete,
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
  AddReceivableItemDto,
  CancelReceivableDto,
  CreateReceivableDto,
  CreateReceivableFromAppointmentDto,
  FindReceivablesDto,
  ReceivableDetailDto,
  ReceivableListResponseDto,
} from '../dto/receivable.dto';
import { RegisterPaymentDto } from '../dto/payment.dto';
import { ReceivablesService } from '../services/receivables.service';
import { PaymentsService } from '../services/payments.service';
import { ownerIdDe } from '../utils/owner';

@ApiTags('Financeiro')
@ApiBearerAuth()
@Controller('finance/receivables')
@RequirePermission(Permission.FINANCEIRO)
export class ReceivablesController {
  constructor(
    private readonly receivablesService: ReceivablesService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar cobranças' })
  @ApiOkResponse({ type: ReceivableListResponseDto })
  findAll(
    @Query() query: FindReceivablesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivableListResponseDto> {
    return this.receivablesService.findAll(ownerIdDe(user), query);
  }

  @Post()
  @ApiOperation({ summary: 'Criar cobrança avulsa' })
  @ApiOkResponse({ type: ReceivableDetailDto })
  create(
    @Body() dto: CreateReceivableDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivableDetailDto> {
    return this.receivablesService.create(ownerIdDe(user), user.userId, dto);
  }

  @Post('from-appointment/:appointmentId')
  @ApiOperation({ summary: 'Criar cobrança a partir da consulta' })
  @ApiOkResponse({ type: ReceivableDetailDto })
  createFromAppointment(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: CreateReceivableFromAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivableDetailDto> {
    return this.receivablesService.createFromAppointment(
      ownerIdDe(user),
      user.userId,
      appointmentId,
      {
        allowHealthPlan: dto.allowHealthPlan === true,
        unitAmount: dto.unitAmount,
      },
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhar cobrança' })
  @ApiOkResponse({ type: ReceivableDetailDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivableDetailDto> {
    return this.receivablesService.findOne(ownerIdDe(user), id);
  }

  @Post(':id/items')
  @ApiOperation({ summary: 'Adicionar item à cobrança' })
  @ApiOkResponse({ type: ReceivableDetailDto })
  addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddReceivableItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivableDetailDto> {
    return this.receivablesService.addItem(
      ownerIdDe(user),
      user.userId,
      id,
      dto.item,
    );
  }

  @Delete(':id/items/:itemId')
  @ApiOperation({ summary: 'Cancelar item da cobrança' })
  @ApiOkResponse({ type: ReceivableDetailDto })
  cancelItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivableDetailDto> {
    return this.receivablesService.cancelItem(
      ownerIdDe(user),
      user.userId,
      id,
      itemId,
    );
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancelar cobrança sem pagamento' })
  @ApiOkResponse({ type: ReceivableDetailDto })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelReceivableDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivableDetailDto> {
    return this.receivablesService.cancel(
      ownerIdDe(user),
      user.userId,
      id,
      dto.reason,
    );
  }

  @Post(':id/payments')
  @ApiOperation({ summary: 'Registrar pagamento (uma ou mais formas)' })
  @ApiOkResponse({ type: ReceivableDetailDto })
  registerPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegisterPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivableDetailDto> {
    return this.paymentsService.register(
      ownerIdDe(user),
      user.userId,
      id,
      dto,
      user.permissions ?? [],
    );
  }
}
