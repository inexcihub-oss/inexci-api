import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  email_notifications?: boolean;

  @IsOptional()
  @IsBoolean()
  sms_notifications?: boolean;

  @IsOptional()
  @IsBoolean()
  push_notifications?: boolean;

  @IsOptional()
  @IsBoolean()
  new_surgery_request?: boolean;

  @IsOptional()
  @IsBoolean()
  status_update?: boolean;

  @IsOptional()
  @IsBoolean()
  pendencies?: boolean;

  @IsOptional()
  @IsBoolean()
  expiring_documents?: boolean;

  @IsOptional()
  @IsBoolean()
  weekly_report?: boolean;
}
