import { MailTemplateName } from 'src/config/mail.config';
import {
  WHATSAPP_TEMPLATES,
  WhatsappTemplateName,
} from 'src/shared/whatsapp/whatsapp-templates.constants';

const MAIL_LABELS: Record<MailTemplateName | 'raw_html', string> = {
  'surgery-request-sent': 'Solicitação enviada',
  'surgery-authorized': 'Cirurgia autorizada',
  'surgery-contested': 'Autorização contestada',
  'surgery-scheduled': 'Cirurgia agendada',
  'invoice-sent': 'Fatura enviada',
  'payment-received': 'Pagamento recebido',
  'payment-contested': 'Pagamento contestado',
  'status-change-patient': 'Mudança de status (paciente)',
  'appointment-reminder': 'Lembrete de consulta',
  'welcome-patient': 'Boas-vindas ao paciente',
  'invite-collaborator': 'Convite de colaborador',
  'invite-platform-admin': 'Convite de administrador',
  'password-recovery': 'Recuperação de senha',
  'email-verification': 'Confirmação de e-mail',
  'weekly-summary': 'Resumo semanal',
  'generic-notification': 'Notificação',
  raw_html: 'E-mail avulso',
};

const WHATSAPP_LABELS: Record<WhatsappTemplateName, string> = {
  WELCOME_PATIENT: 'Boas-vindas ao paciente',
  WELCOME_USER: 'Boas-vindas ao usuário',
  STALE_STATUS_MESSAGE: 'Solicitação parada',
  STATUS_CHANGE_PATIENT: 'Mudança de status (paciente)',
  MESSAGE_SCHEDULING_PATIENT: 'Opções de data da cirurgia',
  STATUS_CHANGE_USERS: 'Mudança de status (equipe)',
  AI_ACTION_CONFIRMATION: 'Confirmação de ação da IA',
  APPOINTMENT_CONFIRMATION: 'Lembrete de consulta',
  APPOINTMENT_SCHEDULED: 'Consulta agendada',
  APPOINTMENT_CANCELLED: 'Consulta cancelada',
};

const BY_SID = new Map<string, string>(
  (Object.keys(WHATSAPP_TEMPLATES) as WhatsappTemplateName[])
    .filter((name) => WHATSAPP_TEMPLATES[name])
    .map((name) => [WHATSAPP_TEMPLATES[name], WHATSAPP_LABELS[name]]),
);

export function templateLabel(template: string | null): string | null {
  if (!template) return null;
  return (
    BY_SID.get(template) ?? MAIL_LABELS[template as MailTemplateName] ?? null
  );
}
