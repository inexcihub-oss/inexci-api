import { Injectable, Logger } from '@nestjs/common';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { WHATSAPP_TEMPLATES } from 'src/shared/whatsapp/whatsapp-templates.constants';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';
import { getStatusLabel, getStatusDescriptionForPatient } from 'src/shared/utils';

export interface PatientNotificationContext {
  request: {
    id: string;
    protocol?: string;
    patient?: {
      name?: string;
      email?: string;
      phone?: string;
    };
    hospital?: { name?: string };
    created_by?: { name?: string };
  };
  oldStatus: SurgeryRequestStatus;
  newStatus: SurgeryRequestStatus;
  notifyPatient?: boolean;
}

@Injectable()
export class PatientNotificationService {
  private readonly logger = new Logger(PatientNotificationService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly whatsappService: WhatsappService,
  ) {}

  async notifyPatientStatusChange(
    ctx: PatientNotificationContext,
  ): Promise<void> {
    if (!ctx.notifyPatient) return;

    const patient = ctx.request.patient;
    const patientEmail = patient?.email;
    const patientPhone = patient?.phone;

    if (!patientEmail && !patientPhone) {
      this.logger.warn(
        `notifyPatient solicitado mas paciente sem e-mail e sem telefone (solicitação ${ctx.request.id})`,
      );
      return;
    }

    const patientName = patient?.name ?? 'Paciente';
    const requestId = ctx.request.protocol ?? ctx.request.id;
    const oldLabel = getStatusLabel(ctx.oldStatus);
    const newLabel = getStatusLabel(ctx.newStatus);
    const statusDescription = getStatusDescriptionForPatient(ctx.newStatus);
    const changedAt = new Date().toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Send email if patient has email
    if (patientEmail) {
      try {
        await this.mailService.sendStatusUpdate(patientEmail, {
          patientName,
          requestId,
          oldStatus: oldLabel,
          newStatus: newLabel,
          changedAt,
        });
      } catch (err: any) {
        this.logger.warn(
          `Falha ao notificar paciente por e-mail: ${err?.message}`,
        );
      }
    } else {
      this.logger.warn(
        `notifyPatient solicitado mas paciente sem e-mail (solicitação ${ctx.request.id})`,
      );
    }

    // Send WhatsApp if patient has phone
    if (patientPhone) {
      try {
        await this.whatsappService.sendTemplate(
          patientPhone,
          WHATSAPP_TEMPLATES.STATUS_CHANGE_PATIENT,
          {
            '1': patientName,
            '2': newLabel,
            '3': statusDescription,
          },
        );
      } catch (err: any) {
        this.logger.warn(
          `Falha ao notificar paciente por WhatsApp: ${err?.message}`,
        );
      }
    } else {
      this.logger.warn(
        `notifyPatient solicitado mas paciente sem telefone (solicitação ${ctx.request.id})`,
      );
    }
  }
}
