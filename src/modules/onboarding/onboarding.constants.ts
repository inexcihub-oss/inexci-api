import {
  OnboardingState,
  OnboardingStatus,
  StepKey,
  TrackId,
} from './onboarding.types';

export const ONBOARDING_STATE_VERSION = 1;

/**
 * Whitelist do DTO. É espelho de `lib/onboarding/state.ts` no frontend — os
 * valores viajam pela API, então não mude um lado sem o outro, exatamente
 * como já acontece com `lib/permissions.ts` e o enum `Permission`.
 */
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
];

export const ONBOARDING_STATUSES: readonly OnboardingStatus[] = [
  'not_started',
  'in_progress',
  'dismissed',
  'completed',
];

/** Estado de quem nunca começou. Objeto novo a cada chamada, de propósito. */
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
