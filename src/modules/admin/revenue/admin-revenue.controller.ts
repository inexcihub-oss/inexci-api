import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRevenueService } from './admin-revenue.service';
import {
  AdminAccountInvoicesQueryDto,
  AdminInvoicesQueryDto,
  AdminRevenueForecastQueryDto,
  AdminRevenueSummaryQueryDto,
} from './dto/admin-revenue-query.dto';
import {
  AdminDelinquencyResponseDto,
  AdminForecastResponseDto,
  AdminInvoiceListResponseDto,
  AdminPlanDto,
  AdminRevenueSummaryDto,
} from './dto/admin-revenue-response.dto';
import { PlatformAdminOnly } from '../auth/platform-admin-only.decorator';

const DEFAULT_LIMIT = 25;
const DEFAULT_FORECAST_MONTHS = 6;

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin')
export class AdminRevenueController {
  constructor(private readonly service: AdminRevenueService) {}

  @Get('revenue/summary')
  @ApiOperation({
    summary:
      'Recebido no mês, em aberto, inadimplência, MRR, ARR, ticket médio e descontos',
  })
  @ApiOkResponse({ type: AdminRevenueSummaryDto })
  summary(
    @Query() query: AdminRevenueSummaryQueryDto,
  ): Promise<AdminRevenueSummaryDto> {
    return this.service.getSummary(query.month);
  }

  @Get('revenue/forecast')
  @ApiOperation({
    summary: 'Previsão de recebimento por mês (garantido e trials com cartão)',
  })
  @ApiOkResponse({ type: AdminForecastResponseDto })
  forecast(
    @Query() query: AdminRevenueForecastQueryDto,
  ): Promise<AdminForecastResponseDto> {
    return this.service.getForecast(query.months ?? DEFAULT_FORECAST_MONTHS);
  }

  @Get('revenue/invoices')
  @ApiOperation({ summary: 'Faturas espelhadas da Stripe' })
  @ApiOkResponse({ type: AdminInvoiceListResponseDto })
  invoices(
    @Query() query: AdminInvoicesQueryDto,
  ): Promise<AdminInvoiceListResponseDto> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && to <= from) {
      throw new BadRequestException('"to" deve ser posterior a "from"');
    }
    return this.service.listInvoices({
      status: query.status,
      ownerId: query.ownerId,
      from,
      to,
      limit: query.limit ?? DEFAULT_LIMIT,
      offset: query.offset ?? 0,
    });
  }

  @Get('revenue/delinquency')
  @ApiOperation({
    summary: 'Contas inadimplentes e suspensas com valor em aberto',
  })
  @ApiOkResponse({ type: AdminDelinquencyResponseDto })
  delinquency(): Promise<AdminDelinquencyResponseDto> {
    return this.service.getDelinquency();
  }

  @Get('accounts/:ownerId/invoices')
  @ApiOperation({ summary: 'Faturas de uma conta' })
  @ApiOkResponse({ type: AdminInvoiceListResponseDto })
  accountInvoices(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Query() query: AdminAccountInvoicesQueryDto,
  ): Promise<AdminInvoiceListResponseDto> {
    return this.service.listInvoices({
      ownerId,
      limit: query.limit ?? DEFAULT_LIMIT,
      offset: query.offset ?? 0,
    });
  }

  @Get('plans')
  @ApiOperation({
    summary: 'Planos do banco com o preço lido da Stripe e a divergência',
  })
  @ApiOkResponse({ type: [AdminPlanDto] })
  plans(): Promise<AdminPlanDto[]> {
    return this.service.listPlans();
  }
}
