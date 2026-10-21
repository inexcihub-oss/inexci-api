import { Module } from '@nestjs/common';
import { AccountsController } from './controllers/accounts.controller';
import { PaymentMethodsController } from './controllers/payment-methods.controller';
import { FinancialAccountsService } from './services/financial-accounts.service';
import { PaymentMethodConfigsService } from './services/payment-method-configs.service';
import { ServicePricesController } from './controllers/service-prices.controller';
import { ServicePricesService } from './services/service-prices.service';
import { PdfModule } from 'src/shared/pdf/pdf.module';
import { FinanceReportsController } from './controllers/finance-reports.controller';
import { AccountStatementController } from './controllers/account-statement.controller';
import { PaymentReceiptController } from './controllers/payment-receipt.controller';
import { FinanceReportsService } from './services/finance-reports.service';
import { AccountStatementService } from './services/account-statement.service';
import { PaymentReceiptService } from './services/payment-receipt.service';
import { ReceivablesController } from './controllers/receivables.controller';
import { PaymentsController } from './controllers/payments.controller';
import {
  FinanceAppointmentsController,
  FinancePatientsController,
  FinanceProfessionalsController,
} from './controllers/finance-appointments.controller';
import {
  CashSessionsController,
  TransfersController,
} from './controllers/cash-sessions.controller';
import { ReceivablesService } from './services/receivables.service';
import { PaymentsService } from './services/payments.service';
import { RefundsService } from './services/refunds.service';
import { CashSessionsService } from './services/cash-sessions.service';
import { TransfersService } from './services/transfers.service';

@Module({
  imports: [PdfModule],
  controllers: [
    AccountsController,
    PaymentMethodsController,
    ServicePricesController,
    FinanceReportsController,
    AccountStatementController,
    PaymentReceiptController,
    ReceivablesController,
    PaymentsController,
    FinanceAppointmentsController,
    FinancePatientsController,
    FinanceProfessionalsController,
    CashSessionsController,
    TransfersController,
  ],
  providers: [
    FinancialAccountsService,
    PaymentMethodConfigsService,
    ServicePricesService,
    FinanceReportsService,
    AccountStatementService,
    PaymentReceiptService,
    ReceivablesService,
    PaymentsService,
    RefundsService,
    CashSessionsService,
    TransfersService,
  ],
  exports: [
    FinancialAccountsService,
    PaymentMethodConfigsService,
    ServicePricesService,
    ReceivablesService,
    PaymentsService,
    CashSessionsService,
  ],
})
export class FinanceModule {}
