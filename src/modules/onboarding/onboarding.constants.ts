import {
  OnboardingState,
  OnboardingStatus,
  StepKey,
  TrackId,
} from './onboarding.types';

export const ONBOARDING_STATE_VERSION = 1;

export const ONBOARDING_STEP_KEYS: readonly StepKey[] = [
  'conhecer-plataforma',
  'criar-solicitacao',
  'enviar-solicitacao',
  'criar-por-documento',
  'assinatura-do-medico',
  'cabecalho-do-medico',
  'marcar-consulta',
  'atender-consulta',
  'cadastros-basicos',
  'convidar-colaborador',
  'plano-e-cota',
  'ver-dashboard',
];

export const ONBOARDING_TRACK_IDS: readonly TrackId[] = [
  'boas-vindas',
  'solicitacoes',
  'documentos-do-medico',
  'atendimento',
  'agenda',
  'cadastros',
  'administracao',
  'plano-e-cota',
  'dashboard',
];

export const ONBOARDING_STATUSES: readonly OnboardingStatus[] = [
  'not_started',
  'in_progress',
  'dismissed',
  'completed',
];

export function emptyOnboardingState(): OnboardingState {
  return {
    version: ONBOARDING_STATE_VERSION,
    status: 'not_started',
    welcomeSeenAt: null,
    checklistDismissedAt: null,
    completedSteps: {},
    toursSeen: {},
    restartedAt: null,
  };
}
