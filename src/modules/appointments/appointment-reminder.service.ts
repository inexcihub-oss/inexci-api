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
import { formatAppointmentWhen, formatDoctorName } from 'src/shared/utils';
import { errorMessage } from 'src/shared/utils/error-message.util';

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

const TYPE_LABELS: Record<AppointmentType, string> = {
  [AppointmentType.FIRST_VISIT]: 'Primeira consulta',
  [AppointmentType.RETURN]: 'Retorno',
  [AppointmentType.FOLLOW_UP]: 'Acompanhamento',
};

interface ReminderOutcome {
  attempted: boolean;
  delivered: boolean;
}

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
    } catch (err) {
      this.logger.error(`Erro no cron de lembretes: ${errorMessage(err)}`);
    }
  }

  async sendDueReminders(now: Date = new Date()): Promise<number> {
    const until = new Date(now.getTime() + REMINDER_WINDOW_MS);
    const due = await this.appointmentRepository.findDueForReminder(now, until);

    let sent = 0;
    for (const appt of due) {
      try {
        const outcome = await this.notify(appt);

        if (outcome.attempted && !outcome.delivered) {
          this.logger.warn(
            `Lembrete da consulta ${appt.id} não foi enfileirado em nenhum canal; será retentado.`,
          );
          continue;
        }

        await this.appointmentRepository.update(appt.id, {
          reminderSentAt: new Date(),
        });
        if (outcome.delivered) sent++;
      } catch (err) {
        this.logger.warn(
          `Falha ao enviar lembrete da consulta ${appt.id}: ${errorMessage(err)}`,
        );
      }
    }
    return sent;
  }

  private async notify(appt: Appointment): Promise<ReminderOutcome> {
    const habilitado = await this.userRepository.isPatientNotificationEnabled(
      appt.ownerId,
      'appointmentReminder',
    );
    if (!habilitado) return { attempted: false, delivered: false };

    const patient = await this.patientRepository.findOne({
      id: appt.patientId,
    });
    if (!patient) return { attempted: false, delivered: false };

    const doctor = await this.userRepository.findOne({ id: appt.doctorId });
    const doctorName = formatDoctorName(doctor?.name);
    const when = formatAppointmentWhen(appt.scheduledAt);

    let attempted = false;
    let delivered = false;

    if (patient.email) {
      attempted = true;
      try {
        await this.mailService.sendAppointmentReminder(patient.email, {
          patientName: patient.name,
          doctorName,
          when,
          typeLabel: TYPE_LABELS[appt.type],
          durationLabel: `${appt.durationMinutes} min`,
        });
        delivered = true;
      } catch (err) {
        this.logger.warn(
          `Falha ao enfileirar e-mail do lembrete da consulta ${appt.id}: ${errorMessage(err)}`,
        );
      }
    }

    if (patient.phone) {
      attempted = true;
      try {
        await this.whatsappService.sendAppointmentConfirmation(patient.phone, {
          patientName: patient.name,
          doctorName,
          when,
        });
        delivered = true;
      } catch (err) {
        this.logger.warn(
          `Falha ao enfileirar WhatsApp do lembrete da consulta ${appt.id}: ${errorMessage(err)}`,
        );
      }
    }

    return { attempted, delivered };
  }
}
