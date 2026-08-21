import {
  ONBOARDING_STATE_VERSION,
  emptyOnboardingState,
} from './onboarding.constants';
import { OnboardingState } from './onboarding.types';

/** O que um PATCH pode carregar. `version` fica de fora: é do servidor. */
export type OnboardingPatch = Partial<Omit<OnboardingState, 'version'>>;

/**
 * Devolve um estado completo a partir do que estiver gravado na coluna —
 * `null` (usuário que nunca começou) ou um objeto de uma versão anterior com
 * campos que ainda não existiam.
 */
export function normalizeOnboardingState(raw: unknown): OnboardingState {
  const vazio = emptyOnboardingState();
  if (!raw || typeof raw !== 'object') return vazio;

  const parcial = raw as Partial<OnboardingState>;
  return {
    version: ONBOARDING_STATE_VERSION,
    status: parcial.status ?? vazio.status,
    welcomeSeenAt: parcial.welcomeSeenAt ?? null,
    checklistDismissedAt: parcial.checklistDismissedAt ?? null,
    completedSteps: { ...(parcial.completedSteps ?? {}) },
    toursSeen: { ...(parcial.toursSeen ?? {}) },
    restartedAt: parcial.restartedAt ?? null,
  };
}

/**
 * Aplica um patch parcial sobre o estado atual.
 *
 * `completedSteps` e `toursSeen` são FUNDIDOS, não substituídos: dois
 * dispositivos abertos ao mesmo tempo marcando passos diferentes se
 * sobrescreveriam se o patch trocasse o objeto inteiro.
 *
 * `version` vem sempre do servidor — o cliente não rebaixa o formato.
 */
export function mergeOnboardingState(
  current: OnboardingState,
  patch: OnboardingPatch,
): OnboardingState {
  const base = normalizeOnboardingState(current);

  return {
    ...base,
    ...patch,
    version: ONBOARDING_STATE_VERSION,
    completedSteps: {
      ...base.completedSteps,
      ...(patch.completedSteps ?? {}),
    },
    toursSeen: {
      ...base.toursSeen,
      ...(patch.toursSeen ?? {}),
    },
  };
}
