import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  pushNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsappNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  newSurgeryRequest?: boolean;

  @IsOptional()
  @IsBoolean()
  statusUpdate?: boolean;

  @IsOptional()
  @IsBoolean()
  pendencies?: boolean;

  @IsOptional()
  @IsBoolean()
  expiringDocuments?: boolean;

  @IsOptional()
  @IsBoolean()
  weeklyReport?: boolean;
}
