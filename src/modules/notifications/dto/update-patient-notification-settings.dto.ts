import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { PatientNotificationSettings } from 'src/common/patient-notification-settings';

export class UpdatePatientNotificationSettingsDto implements Partial<PatientNotificationSettings> {
  @ApiPropertyOptional({
    description:
      'WhatsApp ao paciente quando a consulta é marcada, remarcada ou reativada',
  })
  @IsOptional()
  @IsBoolean()
  appointmentScheduled?: boolean;

  @ApiPropertyOptional({
    description: 'E-mail e WhatsApp ao paciente 24 h antes da consulta',
  })
  @IsOptional()
  @IsBoolean()
  appointmentReminder?: boolean;

  @ApiPropertyOptional({
    description: 'WhatsApp ao paciente quando a consulta é cancelada',
  })
  @IsOptional()
  @IsBoolean()
  appointmentCancelled?: boolean;
}
