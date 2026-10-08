import { IsBoolean, IsOptional } from 'class-validator';

export class UpdatePatientNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  appointmentScheduled?: boolean;

  @IsOptional()
  @IsBoolean()
  appointmentReminder?: boolean;

  @IsOptional()
  @IsBoolean()
  appointmentCancelled?: boolean;
}
