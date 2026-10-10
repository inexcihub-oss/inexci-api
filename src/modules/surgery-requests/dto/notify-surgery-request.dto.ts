import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MailTemplateName, MAIL_TEMPLATES } from 'src/config/mail.config';

export class NotifyChannelsDto {
  @IsOptional()
  email?: boolean;

  @IsOptional()
  whatsapp?: boolean;
}

export class NotifySurgeryRequestDto {
  @IsIn(MAIL_TEMPLATES)
  template: MailTemplateName;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NotifyChannelsDto)
  channels?: NotifyChannelsDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  oldStatus?: number;
}
