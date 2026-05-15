import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SurgeryRequestWorkflowService } from '../../../modules/surgery-requests/services/surgery-request-workflow.service';

export type WorkflowEngineAction =
  | 'send_request'
  | 'start_analysis'
  | 'accept_authorization'
  | 'contest_authorization'
  | 'confirm_date'
  | 'update_date_options'
  | 'reschedule'
  | 'mark_performed'
  | 'invoice_request'
  | 'confirm_receipt'
  | 'contest_payment'
  | 'update_receipt'
  | 'close_surgery_request';

@Injectable()
export class WorkflowEngineService {
  constructor(
    private readonly workflowService: SurgeryRequestWorkflowService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(input: {
    action: WorkflowEngineAction;
    surgeryRequestId: string;
    dto: Record<string, unknown>;
    userId: string;
  }): Promise<unknown> {
    const start = Date.now();
    const result = await this.dispatch(input);
    this.eventEmitter.emit('ai.workflow.executed', {
      action: input.action,
      surgeryRequestId: input.surgeryRequestId,
      userId: input.userId,
      durationMs: Date.now() - start,
    });
    return result;
  }

  sendRequest(id: string, dto: Record<string, unknown>, userId: string) {
    return this.execute({
      action: 'send_request',
      surgeryRequestId: id,
      dto,
      userId,
    });
  }

  startAnalysis(id: string, dto: Record<string, unknown>, userId: string) {
    return this.execute({
      action: 'start_analysis',
      surgeryRequestId: id,
      dto,
      userId,
    });
  }

  acceptAuthorization(
    id: string,
    dto: Record<string, unknown>,
    userId: string,
  ) {
    return this.execute({
      action: 'accept_authorization',
      surgeryRequestId: id,
      dto,
      userId,
    });
  }

  contestAuthorization(
    id: string,
    dto: Record<string, unknown>,
    userId: string,
  ) {
    return this.execute({
      action: 'contest_authorization',
      surgeryRequestId: id,
      dto,
      userId,
    });
  }

  confirmDate(id: string, dto: Record<string, unknown>, userId: string) {
    return this.execute({
      action: 'confirm_date',
      surgeryRequestId: id,
      dto,
      userId,
    });
  }

  updateDateOptions(id: string, dto: Record<string, unknown>, userId: string) {
    return this.execute({
      action: 'update_date_options',
      surgeryRequestId: id,
      dto,
      userId,
    });
  }

  reschedule(id: string, dto: Record<string, unknown>, userId: string) {
    return this.execute({
      action: 'reschedule',
      surgeryRequestId: id,
      dto,
      userId,
    });
  }

  markPerformed(id: string, dto: Record<string, unknown>, userId: string) {
    return this.execute({
      action: 'mark_performed',
      surgeryRequestId: id,
      dto,
      userId,
    });
  }

  invoiceRequest(id: string, dto: Record<string, unknown>, userId: string) {
    return this.execute({
      action: 'invoice_request',
      surgeryRequestId: id,
      dto,
      userId,
    });
  }

  confirmReceipt(id: string, dto: Record<string, unknown>, userId: string) {
    return this.execute({
      action: 'confirm_receipt',
      surgeryRequestId: id,
      dto,
      userId,
    });
  }

  contestPayment(id: string, dto: Record<string, unknown>, userId: string) {
    return this.execute({
      action: 'contest_payment',
      surgeryRequestId: id,
      dto,
      userId,
    });
  }

  updateReceipt(id: string, dto: Record<string, unknown>, userId: string) {
    return this.execute({
      action: 'update_receipt',
      surgeryRequestId: id,
      dto,
      userId,
    });
  }

  closeSurgeryRequest(
    id: string,
    dto: Record<string, unknown>,
    userId: string,
  ) {
    return this.execute({
      action: 'close_surgery_request',
      surgeryRequestId: id,
      dto,
      userId,
    });
  }

  private dispatch(input: {
    action: WorkflowEngineAction;
    surgeryRequestId: string;
    dto: Record<string, unknown>;
    userId: string;
  }): Promise<unknown> {
    switch (input.action) {
      case 'send_request':
        return this.workflowService.sendRequest(
          input.surgeryRequestId,
          input.dto as any,
          input.userId,
        );
      case 'start_analysis':
        return this.workflowService.startAnalysis(
          input.surgeryRequestId,
          input.dto as any,
          input.userId,
        );
      case 'accept_authorization':
        return this.workflowService.acceptAuthorization(
          input.surgeryRequestId,
          input.dto as any,
          input.userId,
        );
      case 'contest_authorization':
        return this.workflowService.contestAuthorization(
          input.surgeryRequestId,
          input.dto as any,
          input.userId,
        );
      case 'confirm_date':
        return this.workflowService.confirmDate(
          input.surgeryRequestId,
          input.dto as any,
          input.userId,
        );
      case 'update_date_options':
        return this.workflowService.updateDateOptions(
          input.surgeryRequestId,
          input.dto as any,
          input.userId,
        );
      case 'reschedule':
        return this.workflowService.reschedule(
          input.surgeryRequestId,
          input.dto as any,
          input.userId,
        );
      case 'mark_performed':
        return this.workflowService.markPerformed(
          input.surgeryRequestId,
          input.dto as any,
          input.userId,
        );
      case 'invoice_request':
        return this.workflowService.invoiceRequest(
          input.surgeryRequestId,
          input.dto as any,
          input.userId,
        );
      case 'confirm_receipt':
        return this.workflowService.confirmReceipt(
          input.surgeryRequestId,
          input.dto as any,
          input.userId,
        );
      case 'contest_payment':
        return this.workflowService.contestPayment(
          input.surgeryRequestId,
          input.dto as any,
          input.userId,
        );
      case 'update_receipt':
        return this.workflowService.updateReceipt(
          input.surgeryRequestId,
          input.dto as any,
          input.userId,
        );
      case 'close_surgery_request':
        return this.workflowService.closeSurgeryRequest(
          input.surgeryRequestId,
          input.dto as any,
          input.userId,
        );
    }
  }
}
