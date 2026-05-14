import { Injectable } from '@nestjs/common';

import { SendAnalysisHandler } from './workflow/send-analysis.handler';
import { AuthorizationHandler } from './workflow/authorization.handler';
import { SchedulingHandler } from './workflow/scheduling.handler';
import { ExecutionHandler } from './workflow/execution.handler';
import { SurgeryRequestBillingService } from './surgery-request-billing.service';
import { SurgeryRequestNotificationService } from './surgery-request-notification.service';

import { SendRequestDto } from '../dto/send-request.dto';
import { StartAnalysisDto } from '../dto/start-analysis.dto';
import { AcceptAuthorizationDto } from '../dto/accept-authorization.dto';
import { ContestAuthorizationDto } from '../dto/contest-authorization.dto';
import { ConfirmDateDto } from '../dto/confirm-date.dto';
import { UpdateDateOptionsDto } from '../dto/update-date-options.dto';
import { RescheduleDto } from '../dto/reschedule.dto';
import { MarkPerformedDto } from '../dto/mark-performed.dto';
import { InvoiceRequestDto } from '../dto/invoice-request.dto';
import { ConfirmReceiptDto } from '../dto/confirm-receipt.dto';
import { ContestPaymentDto } from '../dto/contest-payment.dto';
import { UpdateReceiptDto } from '../dto/update-receipt.dto';
import { CloseSurgeryRequestDto } from '../dto/close-surgery-request.dto';

/**
 * Orquestrador de transições de status da solicitação cirúrgica.
 *
 * Delega a lógica para handlers especializados por fase:
 * - SendAnalysisHandler: envio e início da análise
 * - AuthorizationHandler: autorização e contestação
 * - SchedulingHandler: agendamento e reagendamento
 * - ExecutionHandler: realização e encerramento
 * - SurgeryRequestBillingService: faturamento (já existente)
 */
@Injectable()
export class SurgeryRequestWorkflowService {
  constructor(
    private readonly sendAnalysisHandler: SendAnalysisHandler,
    private readonly authorizationHandler: AuthorizationHandler,
    private readonly schedulingHandler: SchedulingHandler,
    private readonly executionHandler: ExecutionHandler,
    private readonly billingService: SurgeryRequestBillingService,
    private readonly notificationService: SurgeryRequestNotificationService,
  ) {}

  // ── Envio e Análise ────────────────────────────────────────────────────────

  exportSurgeryRequestPdf(id: string, userId: string): Promise<Buffer> {
    return this.sendAnalysisHandler.exportSurgeryRequestPdf(id, userId);
  }

  sendRequest(id: string, dto: SendRequestDto, userId: string) {
    return this.sendAnalysisHandler.sendRequest(id, dto, userId);
  }

  startAnalysis(id: string, dto: StartAnalysisDto, userId: string) {
    return this.sendAnalysisHandler.startAnalysis(id, dto, userId);
  }

  // ── Autorização ────────────────────────────────────────────────────────────

  acceptAuthorization(id: string, dto: AcceptAuthorizationDto, userId: string) {
    return this.authorizationHandler.acceptAuthorization(id, dto, userId);
  }

  contestAuthorization(
    id: string,
    dto: ContestAuthorizationDto,
    userId: string,
  ) {
    return this.authorizationHandler.contestAuthorization(id, dto, userId);
  }

  generateContestAuthorizationPdf(id: string, userId: string): Promise<Buffer> {
    return this.authorizationHandler.generateContestAuthorizationPdf(
      id,
      userId,
    );
  }

  // ── Agendamento ────────────────────────────────────────────────────────────

  confirmDate(id: string, dto: ConfirmDateDto, userId: string) {
    return this.schedulingHandler.confirmDate(id, dto, userId);
  }

  updateDateOptions(id: string, dto: UpdateDateOptionsDto, userId: string) {
    return this.schedulingHandler.updateDateOptions(id, dto, userId);
  }

  reschedule(id: string, dto: RescheduleDto, userId: string) {
    return this.schedulingHandler.reschedule(id, dto, userId);
  }

  // ── Execução e Encerramento ────────────────────────────────────────────────

  markPerformed(id: string, dto: MarkPerformedDto, userId: string) {
    return this.executionHandler.markPerformed(id, dto, userId);
  }

  closeSurgeryRequest(id: string, dto: CloseSurgeryRequestDto, userId: string) {
    return this.executionHandler.closeSurgeryRequest(id, dto, userId);
  }

  // ── Billing (delegado para SurgeryRequestBillingService) ───────────────────

  invoiceRequest(id: string, dto: InvoiceRequestDto, userId: string) {
    return this.billingService.invoiceRequest(id, dto, userId);
  }

  confirmReceipt(id: string, dto: ConfirmReceiptDto, userId: string) {
    return this.billingService.confirmReceipt(id, dto, userId);
  }

  contestPayment(id: string, dto: ContestPaymentDto, userId: string) {
    return this.billingService.contestPayment(id, dto, userId);
  }

  updateReceipt(id: string, dto: UpdateReceiptDto, userId: string) {
    return this.billingService.updateReceipt(id, dto, userId);
  }

  // ── Notificação ────────────────────────────────────────────────────────────

  notify(
    id: string,
    dto: {
      template: string;
      to?: string;
      channels?: { email?: boolean; whatsapp?: boolean };
      oldStatus?: number;
    },
    userId: string,
  ) {
    return this.notificationService.notify(id, dto, userId);
  }
}
