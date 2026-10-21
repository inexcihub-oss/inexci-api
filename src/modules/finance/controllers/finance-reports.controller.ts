import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
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
import { FinanceReportsService } from '../services/finance-reports.service';
import {
  OpenReportDto,
  OpenReportQueryDto,
  ProductionReportDto,
  ProductionReportQueryDto,
  ReceiptsReportDto,
  ReceiptsReportQueryDto,
} from '../dto/finance-report.dto';
import { ownerIdDe } from '../utils/owner';
import {
  bytesDoCsv,
  CONTENT_TYPE_CSV,
  contentDispositionCsv,
} from '../utils/csv';

export function arquivoCsv(conteudo: string, nome: string): StreamableFile {
  return new StreamableFile(bytesDoCsv(conteudo), {
    type: CONTENT_TYPE_CSV,
    disposition: contentDispositionCsv(nome),
  });
}

@ApiTags('Financeiro')
@ApiBearerAuth()
@Controller('finance/reports')
@RequirePermission(Permission.FINANCEIRO)
export class FinanceReportsController {
  constructor(private readonly reportsService: FinanceReportsService) {}

  @Get('receipts')
  @ApiOperation({ summary: 'Relatório de recebimentos agrupado' })
  @ApiProduces('application/json', CONTENT_TYPE_CSV)
  @ApiOkResponse({ type: ReceiptsReportDto })
  async receipts(
    @Query() query: ReceiptsReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceiptsReportDto | StreamableFile> {
    const relatorio = await this.reportsService.receipts(
      ownerIdDe(user),
      { from: query.from, to: query.to },
      query.groupBy,
    );
    if (query.format !== 'csv') return relatorio;
    return arquivoCsv(
      this.reportsService.receiptsCsv(relatorio),
      `recebimentos-${query.groupBy}-${query.from}-${query.to}.csv`,
    );
  }

  @Get('production')
  @ApiOperation({ summary: 'Relatório de produção por profissional' })
  @ApiProduces('application/json', CONTENT_TYPE_CSV)
  @ApiOkResponse({ type: ProductionReportDto })
  async production(
    @Query() query: ProductionReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProductionReportDto | StreamableFile> {
    const relatorio = await this.reportsService.production(ownerIdDe(user), {
      from: query.from,
      to: query.to,
    });
    if (query.format !== 'csv') return relatorio;
    return arquivoCsv(
      this.reportsService.productionCsv(relatorio),
      `producao-${query.from}-${query.to}.csv`,
    );
  }

  @Get('open')
  @ApiOperation({ summary: 'Cobranças em aberto com idade em dias' })
  @ApiProduces('application/json', CONTENT_TYPE_CSV)
  @ApiOkResponse({ type: OpenReportDto })
  async open(
    @Query() query: OpenReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OpenReportDto | StreamableFile> {
    const relatorio = await this.reportsService.open(ownerIdDe(user), {
      until: query.until,
    });
    if (query.format !== 'csv') return relatorio;
    return arquivoCsv(
      this.reportsService.openCsv(relatorio),
      `em-aberto-${query.until ?? 'hoje'}.csv`,
    );
  }
}
