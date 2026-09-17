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

  /**
   * Lembrete de consulta 24h antes, com os botões `consulta_confirmar` e
   * `consulta_cancelar`. Variáveis: {"1": patientName, "2": doctorName, "3": when}.
   *
   * Os ids dos botões são próprios deste fluxo de propósito: uma versão
   * anterior deste template reusava `opcao_1`/`opcao_2`, que são de
   * `MESSAGE_SCHEDULING_PATIENT`, e a resposta do paciente à consulta era lida
   * como escolha de data da cirurgia. Não volte a reusar `opcao_*` aqui.
   */
  APPOINTMENT_CONFIRMATION: 'HX1cb06d48eae7c80e0975afc93176f2b8',

  /**
   * Aviso ao paciente de que a consulta foi marcada (ou remarcada) para uma
   * data. Variáveis: {"1": patientName, "2": doctorName, "3": when} — mesma
   * ordem de `APPOINTMENT_CONFIRMATION`. Sem botões.
   *
   */
  APPOINTMENT_SCHEDULED: 'HXfa617cb787d12c69c73ea5d110a8bcd0',

  /** Aviso de consulta cancelada pela clínica. Variáveis: {"1": patientName, "2": when, "3": doctorName}. */
  APPOINTMENT_CANCELLED: 'HX772a91a08e8987110438cb008d8cd6ca',
} as const;

export type WhatsappTemplateName = keyof typeof WHATSAPP_TEMPLATES;
