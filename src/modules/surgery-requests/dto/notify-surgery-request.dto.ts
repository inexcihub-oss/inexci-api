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

  /**
   * Status anterior (1..9) para preencher corretamente "{oldStatus} → {newStatus}"
   * em templates de mudança de status. Se omitido, o backend infere a partir
   * da última atividade de status registrada na solicitação.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  oldStatus?: number;
}
