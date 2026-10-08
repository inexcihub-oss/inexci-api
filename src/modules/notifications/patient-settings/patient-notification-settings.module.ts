import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatientNotificationSettings } from 'src/database/entities/patient-notification-settings.entity';
import { PatientNotificationSettingsService } from './patient-notification-settings.service';

/**
 * Módulo à parte (e não dentro do `NotificationsModule`) para a Agenda poder
 * consultar a configuração sem herdar o grafo de dependências das
 * notificações in-app (gateway, pendências, e-mail).
 */
@Module({
  imports: [TypeOrmModule.forFeature([PatientNotificationSettings])],
  providers: [PatientNotificationSettingsService],
  exports: [PatientNotificationSettingsService],
})
export class PatientNotificationSettingsModule {}
