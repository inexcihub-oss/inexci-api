import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppointmentRepository } from 'src/database/repositories/appointment.repository';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import {
  Appointment,
  AppointmentType,
} from 'src/database/entities/appointment.entity';

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

const TYPE_LABELS: Record<AppointmentType, string> = {
  [AppointmentType.FIRST_VISIT]: 'Primeira consulta',
  [AppointmentType.RETURN]: 'Retorno',
  [AppointmentType.FOLLOW_UP]: 'Acompanhamento',
};

/**
 * Dispara lembretes de consulta 24h antes (e-mail + WhatsApp), de forma
 * idempotente via `reminderSentAt`. Roda de hora em hora — uma consulta entra
 * na janela [agora, agora+24h] e é lembrada uma única vez.
 */
@Injectable()
export class AppointmentReminderService {
  private readonly logger = new Logger(AppointmentReminderService.name);

  constructor(
    private readonly appointmentRepository: AppointmentRepository,
    private readonly patientRepository: PatientRepository,
    private readonly userRepository: UserRepository,
    private readonly mailService: MailService,
    private readonly whatsappService: WhatsappService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleReminderCron(): Promise<void> {
    try {
      const sent = await this.sendDueReminders();
      if (sent > 0) {
        this.logger.log(`Lembretes de consulta enviados: ${sent}`);
      }
    } catch (err: any) {
      this.logger.error(`Erro no cron de lembretes: ${err?.message}`);
    }
  }

  /** Envia lembretes das consultas devidas e marca `reminderSentAt`. */
  async sendDueReminders(now: Date = new Date()): Promise<number> {
    const until = new Date(now.getTime() + REMINDER_WINDOW_MS);
    const due = await this.appointmentRepository.findDueForReminder(now, until);

    let sent = 0;
    for (const appt of due) {
      try {
        const notified = await this.notify(appt);
        // Marca sempre (mesmo sem canais) para não re-processar a cada hora.
        await this.appointmentRepository.update(appt.id, {
          reminderSentAt: new Date(),
        });
        if (notified) sent++;
      } catch (err: any) {
        this.logger.warn(
          `Falha ao enviar lembrete da consulta ${appt.id}: ${err?.message}`,
        );
      }
    }
    return sent;
  }

  private async notify(appt: Appointment): Promise<boolean> {
    const patient = await this.patientRepository.findOne({
      id: appt.patientId,
    });
    if (!patient) return false;

    const doctor = await this.userRepository.findOne({ id: appt.doctorId });
    const doctorName = doctor?.name ? `Dr(a). ${doctor.name}` : '';
    const when = this.formatWhen(appt.scheduledAt);

    let notified = false;

    if (patient.email) {
      void this.mailService.sendAppointmentReminder(patient.email, {
        patientName: patient.name,
        doctorName,
        when,
        typeLabel: TYPE_LABELS[appt.type],
        durationLabel: `${appt.durationMinutes} min`,
      });
      notified = true;
    }

    if (patient.phone) {
      void this.whatsappService.sendAppointmentReminder(
        patient.phone,
        patient.name,
        when,
        doctorName,
      );
      notified = true;
    }

    return notified;
  }

  /** Formata a data/hora em pt-BR no fuso de São Paulo (ex.: "sex., 01/08 às 14:00"). */
  private formatWhen(date: Date): string {
    const day = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).format(date);
    const time = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).format(date);
    return `${day} às ${time}`;
  }
}
