import { IsIn, IsOptional, IsString } from 'class-validator';
import { MailTemplateName, MAIL_TEMPLATES } from 'src/config/mail.config';

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
}
