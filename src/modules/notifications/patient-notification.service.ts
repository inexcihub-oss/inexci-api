import { Injectable, Logger } from '@nestjs/common';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { WHATSAPP_TEMPLATES } from 'src/shared/whatsapp/whatsapp-templates.constants';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';
import {
  errorMessage,
  getStatusLabel,
  getStatusDescriptionForPatient,
} from 'src/shared/utils';

export interface PatientNotificationContext {
  request: {
    id: string;
    protocol?: string | null;
    surgeryDate?: Date | string | null;
    patient?: {
      name?: string | null;
      email?: string | null;
      phone?: string | null;
    } | null;
    hospital?: { name?: string | null } | null;
    createdBy?: { name?: string | null } | null;
  };
  oldStatus: SurgeryRequestStatus;
  newStatus: SurgeryRequestStatus;
  notifyPatient?: boolean;
  channels?: { email?: boolean; whatsapp?: boolean };
}

export interface PatientSchedulingNotificationContext {
  request: {
    id: string;
    protocol?: string | null;
    patient?: {
      name?: string | null;
      phone?: string | null;
    } | null;
  };
  dateOptions: string[];
}

@Injectable()
export class PatientNotificationService {
  private readonly logger = new Logger(PatientNotificationService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly whatsappService: WhatsappService,
  ) {}

  private formatSchedulingOption(isoDate: string | undefined): string {
    if (!isoDate) return '—';
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return '—';

    const datePart = date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const timePart = minutes === '00' ? `${hours}h` : `${hours}:${minutes}h`;

    return `${datePart} às ${timePart}`;
  }

  async notifyPatientSchedulingOptions(
    ctx: PatientSchedulingNotificationContext,
  ): Promise<void> {
    const patientName = ctx.request.patient?.name ?? 'Paciente';
    const patientPhone = ctx.request.patient?.phone;

    if (!patientPhone) {
      this.logger.warn(
        `Paciente sem telefone para envio de opções de agendamento (solicitação ${ctx.request.id})`,
      );
      return;
    }

    const options = Array.isArray(ctx.dateOptions) ? ctx.dateOptions : [];
    const option1 = this.formatSchedulingOption(options[0]);
    const option2 = this.formatSchedulingOption(options[1]);
    const option3 = this.formatSchedulingOption(options[2]);

    try {
      await this.whatsappService.sendTemplate(
        patientPhone,
        WHATSAPP_TEMPLATES.MESSAGE_SCHEDULING_PATIENT,
        {
          '1': patientName,
          '2': option1,
          '3': option2,
          '4': option3,
        },
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Falha ao enviar opções de agendamento para paciente: ${errorMessage(err)}`,
      );
    }
  }

  async notifyPatientStatusChange(
    ctx: PatientNotificationContext,
  ): Promise<void> {
    if (ctx.notifyPatient !== true) return;

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
    const statusDescription = getStatusDescriptionForPatient(ctx.newStatus, {
      surgeryDate: ctx.request.surgeryDate,
      hospitalName: ctx.request.hospital?.name,
    });
    const changedAt = new Date().toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const sendEmail = ctx.channels ? (ctx.channels.email ?? false) : true;
    const sendWhatsapp = ctx.channels ? (ctx.channels.whatsapp ?? false) : true;

    if (sendEmail) {
      if (patientEmail) {
        try {
          await this.mailService.sendStatusChangePatient(patientEmail, {
            patientName,
            requestId,
            oldStatus: oldLabel,
            newStatus: newLabel,
            changedAt,
          });
        } catch (err: unknown) {
          this.logger.warn(
            `Falha ao notificar paciente por e-mail: ${errorMessage(err)}`,
          );
        }
      } else {
        this.logger.warn(
          `Canal e-mail selecionado mas paciente sem e-mail (solicitação ${ctx.request.id})`,
        );
      }
    }

    if (sendWhatsapp) {
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
        } catch (err: unknown) {
          this.logger.warn(
            `Falha ao notificar paciente por WhatsApp: ${errorMessage(err)}`,
          );
        }
      } else {
        this.logger.warn(
          `Canal WhatsApp selecionado mas paciente sem telefone (solicitação ${ctx.request.id})`,
        );
      }
    }
  }
}
