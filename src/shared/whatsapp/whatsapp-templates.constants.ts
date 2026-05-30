/**
 * contentSid dos templates WhatsApp pré-aprovados pela Meta via Twilio Content API.
 * Envio freeform (sendMessage) só funciona dentro da janela de 24h de uma conversa
 * iniciada pelo usuário. Mensagens proativas DEVEM usar sendTemplate() com contentSid.
 */
export const WHATSAPP_TEMPLATES = {
  /** Boas-vindas ao paciente recém-cadastrado. Variáveis: {"1": patientName} */
  WELCOME_PATIENT: 'HX700d7a2e6b784cc7ff5b488784ae122d',

  /** Boas-vindas ao usuário (médico/colaborador) recém-cadastrado. Variáveis: {"1": userName} */
  WELCOME_USER: 'HXa43748f75eaf95629286ddd036798997',

  /** Notificação de solicitação parada para gestor/médico. Variáveis: {"1": userName, "2": requestNumber, "3": status, "4": staleDays, "5": pendencyMessage} */
  STALE_STATUS_MESSAGE: 'HX4db9fc096503b6c7cee02d36735c5317',

  /** Notificação de mudança de status ao paciente. Variáveis: {"1": patientName, "2": newStatus, "3": statusDescription} */
  STATUS_CHANGE_PATIENT: 'HXa075ce51eb3486868752c2abd23498ae',

  /** Notificação interativa ao paciente com opções de data em Em Agendamento. Variáveis: {"1": patientName, "2": option1, "3": option2, "4": option3} */
  MESSAGE_SCHEDULING_PATIENT: 'HXf574afd88c95466179f08fd2740908fa',

  /**
   * Notificação de mudança de status para usuários da plataforma (médico, gestor, admin, colaborador).
   * Variáveis: {"1": userName, "2": requestProtocol, "3": newStatus, "4": pendencyMessage, "5": patientName}
   */
  STATUS_CHANGE_USERS: 'HXa61aa6d8e8aff00807496f8ce990dcd5',

  /** Template interativo da IA para confirmação de ações sensíveis. Variáveis: {"1": texto da confirmação}. Deixe vazio até aprovação na Meta/Twilio. */
  AI_ACTION_CONFIRMATION: '',
} as const;

export type WhatsappTemplateName = keyof typeof WHATSAPP_TEMPLATES;
