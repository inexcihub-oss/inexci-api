import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import { InvoiceService } from '../services/invoice.service';

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing/invoices')
export class InvoicesController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Get()
  @ApiOperation({ summary: 'Listar faturas (admin logado)' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('take', new DefaultValuePipe(50), ParseIntPipe) take: number,
  ) {
    const { records, total } = await this.invoiceService.listMine(
      user.userId,
      skip,
      take,
    );
    return {
      total,
      records: records.map((r) => ({
        id: r.id,
        amountCents: r.amountCents,
        currency: r.currency,
        status: r.status,
        invoiceUrl: r.invoiceUrl,
        dueDate: r.dueDate,
        paidAt: r.paidAt,
        failedAt: r.failedAt,
        attemptCount: r.attemptCount,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        planSnapshot: r.planSnapshot,
        createdAt: r.createdAt,
      })),
    };
  }
}
