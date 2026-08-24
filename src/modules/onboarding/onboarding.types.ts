/**
 * Estado do onboarding de um usuário, persistido em `users.onboarding_state`.
 *
 * Timestamps são strings ISO-8601, não `Date`: o valor trafega por JSON até o
 * navegador e volta pelo PATCH. Guardar `Date` aqui obrigaria a converter nas
 * duas pontas e a lidar com o que o `JSON.parse` do jsonb devolve (string).
 */
export type OnboardingStatus =
  | 'not_started'
  | 'in_progress'
  | 'dismissed'
  | 'completed';

export type StepKey =
  | 'conhecer-plataforma'
  | 'criar-solicitacao'
  | 'enviar-solicitacao'
  | 'criar-por-documento'
  | 'assinatura-do-medico'
  | 'cabecalho-do-medico'
  | 'marcar-consulta'
  | 'atender-consulta'
  | 'cadastros-basicos'
  | 'convidar-colaborador'
  | 'plano-e-cota'
  | 'ver-dashboard';

export type TrackId =
  | 'boas-vindas'
  | 'solicitacoes'
  | 'documentos-do-medico'
  | 'atendimento'
  | 'agenda'
  | 'cadastros'
  | 'administracao'
  | 'plano-e-cota'
  | 'dashboard';

export interface OnboardingState {
  version: number;
  status: OnboardingStatus;
  welcomeSeenAt: string | null;
  checklistDismissedAt: string | null;
  /**
   * Mapa chave → timestamp, não array. Mapa é idempotente: refazer um passo
   * sobrescreve a data em vez de duplicar a entrada, e "esse passo foi feito?"
   * é um acesso direto.
   */
  completedSteps: Partial<Record<StepKey, string>>;
  toursSeen: Partial<Record<TrackId, string>>;
  restartedAt: string | null;
}
