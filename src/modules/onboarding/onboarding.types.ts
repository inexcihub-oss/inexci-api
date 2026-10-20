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
  completedSteps: Partial<Record<StepKey, string>>;
  toursSeen: Partial<Record<TrackId, string>>;
  restartedAt: string | null;
}
