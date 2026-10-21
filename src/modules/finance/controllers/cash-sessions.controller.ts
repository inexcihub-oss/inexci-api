import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import {
  CashMovementDto,
  CashSessionListResponseDto,
  CashSessionReportQueryDto,
  CashSessionSummaryDto,
  CloseCashSessionDto,
  CurrentCashSessionDto,
  FindCashSessionsDto,
  OpenCashSessionDto,
  TransferDto,
  TransferResultDto,
} from '../dto/cash-session.dto';
import { CashSessionsService } from '../services/cash-sessions.service';
import { TransfersService } from '../services/transfers.service';
import {
  bytesDoCsv,
  CONTENT_TYPE_CSV,
  contentDispositionCsv,
} from '../utils/csv';
import { ownerIdDe } from '../utils/owner';

@ApiTags('Financeiro')
@ApiBearerAuth()
@Controller('finance/cash-sessions')
@RequirePermission(Permission.FINANCEIRO)
export class CashSessionsController {
  constructor(private readonly cashSessionsService: CashSessionsService) {}

  @Get('current')
  @ApiOperation({ summary: 'Caixa aberto do usuário' })
  @ApiOkResponse({ type: CurrentCashSessionDto })
  current(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CurrentCashSessionDto> {
    return this.cashSessionsService.current(ownerIdDe(user), user.userId);
  }

  @Post('current/withdrawals')
  @ApiOperation({ summary: 'Retirada do caixa aberto' })
  @ApiOkResponse({ type: CashSessionSummaryDto })
  withdraw(
    @Body() dto: CashMovementDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CashSessionSummaryDto> {
    return this.cashSessionsService.withdraw(ownerIdDe(user), user.userId, dto);
  }

  @Post('current/supplies')
  @ApiOperation({ summary: 'Suprimento do caixa aberto' })
  @ApiOkResponse({ type: CashSessionSummaryDto })
  supply(
    @Body() dto: CashMovementDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CashSessionSummaryDto> {
    return this.cashSessionsService.supply(ownerIdDe(user), user.userId, dto);
  }

  @Post('current/close')
  @ApiOperation({ summary: 'Fechar o caixa aberto do usuário' })
  @ApiOkResponse({ type: CashSessionSummaryDto })
  closeCurrent(
    @Body() dto: CloseCashSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CashSessionSummaryDto> {
    return this.cashSessionsService.closeCurrent(user, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Abrir caixa' })
  @ApiOkResponse({ type: CashSessionSummaryDto })
  open(
    @Body() dto: OpenCashSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CashSessionSummaryDto> {
    return this.cashSessionsService.open(ownerIdDe(user), user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Histórico de caixas' })
  @ApiOkResponse({ type: CashSessionListResponseDto })
  list(
    @Query() query: FindCashSessionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CashSessionListResponseDto> {
    return this.cashSessionsService.list(user, query);
  }

  @Get(':id/report')
  @ApiOperation({ summary: 'Relatório do caixa (JSON ou CSV)' })
  @ApiProduces('application/json', CONTENT_TYPE_CSV)
  @ApiOkResponse({ type: CashSessionSummaryDto })
  async report(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CashSessionReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CashSessionSummaryDto | StreamableFile> {
    if (query.format !== 'csv') {
      return this.cashSessionsService.summaryFor(user, id);
    }
    const csv = await this.cashSessionsService.reportCsv(user, id);
    return new StreamableFile(bytesDoCsv(csv), {
      type: CONTENT_TYPE_CSV,
      disposition: contentDispositionCsv(`caixa-${id}.csv`),
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Resumo do caixa' })
  @ApiOkResponse({ type: CashSessionSummaryDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CashSessionSummaryDto> {
    return this.cashSessionsService.summaryFor(user, id);
  }

  @Post(':id/close')
  @ApiOperation({
    summary: 'Fechar caixa (de outro usuário exige administração)',
  })
  @ApiOkResponse({ type: CashSessionSummaryDto })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseCashSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CashSessionSummaryDto> {
    return this.cashSessionsService.close(user, id, dto);
  }
}

@ApiTags('Financeiro')
@ApiBearerAuth()
@Controller('finance/transfers')
@RequirePermission(Permission.FINANCEIRO)
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post()
  @ApiOperation({ summary: 'Transferir entre contas' })
  @ApiOkResponse({ type: TransferResultDto })
  transfer(
    @Body() dto: TransferDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TransferResultDto> {
    return this.transfersService.transfer(
      ownerIdDe(user),
      user.userId,
      dto,
      user.permissions ?? [],
    );
  }
}
