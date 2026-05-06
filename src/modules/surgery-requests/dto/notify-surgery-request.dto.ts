import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
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

/**
 * POST /surgery-requests/:id/notify
 * Envia manualmente um e-mail de notificação para um destinatário específico.
 * O template deve ser compatível com o status atual da solicitação.
 */
export class NotifySurgeryRequestDto {
  @IsIn(MAIL_TEMPLATES)
  template: MailTemplateName;

  @IsOptional()
  @IsString()
  to?: string; // Se não informado, usa o e-mail do criador da solicitação

  /** Canais de notificação ao paciente (usado com template status-change-patient) */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NotifyChannelsDto)
  channels?: NotifyChannelsDto;
}
