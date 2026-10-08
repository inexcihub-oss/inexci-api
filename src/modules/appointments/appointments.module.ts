import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Appointment } from 'src/database/entities/appointment.entity';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { AppointmentReminderService } from './appointment-reminder.service';
import { MailModule } from 'src/shared/mail/mail.module';
import { WhatsappModule } from 'src/shared/whatsapp/whatsapp.module';
import { AvailabilityModule } from '../availability/availability.module';
import { PatientNotificationSettingsModule } from '../notifications/patient-settings/patient-notification-settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Appointment]),
    MailModule,
    WhatsappModule,
    AvailabilityModule,
    PatientNotificationSettingsModule,
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AppointmentReminderService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
