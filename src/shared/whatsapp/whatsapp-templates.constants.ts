/**
 * contentSid dos templates WhatsApp pré-aprovados pela Meta via Twilio Content API.
 * Cada valor deve ser definido via variável de ambiente — os templates precisam ser
 * criados no painel do Twilio e aprovados pela Meta antes de serem usados em produção.
 *
 * Envio freeform (sendMessage) só funciona dentro da janela de 24h de uma conversa
 * iniciada pelo usuário. Mensagens proativas DEVEM usar sendTemplate() com contentSid.
 */
export const WHATSAPP_TEMPLATES = {
  /** Notificação de mudança de status ao paciente. Variáveis: {"1": patientName, "2": newStatus, "3": hospitalName} */
  STATUS_CHANGE_PATIENT: process.env.TWILIO_TEMPLATE_STATUS_CHANGE_PATIENT ?? '',

  /** Lembrete de solicitação parada (3-7 dias). Variáveis: {"1": userName, "2": patientName, "3": staleDays, "4": currentStatus} */
  STALE_REMINDER: process.env.TWILIO_TEMPLATE_STALE_REMINDER ?? '',

  /** Alerta crítico de solicitação parada (15-30 dias). Variáveis: {"1": userName, "2": patientName, "3": staleDays} */
  STALE_CRITICAL: process.env.TWILIO_TEMPLATE_STALE_CRITICAL ?? '',

  /** Boas-vindas ao paciente recém-cadastrado. Variáveis: {"1": patientName, "2": doctorName} */
  WELCOME_PATIENT: process.env.TWILIO_TEMPLATE_WELCOME_PATIENT ?? '',

  /** Boas-vindas ao médico recém-cadastrado. Variáveis: {"1": doctorName} */
  WELCOME_DOCTOR: process.env.TWILIO_TEMPLATE_WELCOME_DOCTOR ?? '',
} as const;

export type WhatsappTemplateName = keyof typeof WHATSAPP_TEMPLATES;
