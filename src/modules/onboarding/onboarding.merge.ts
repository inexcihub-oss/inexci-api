import {
  ONBOARDING_STATE_VERSION,
  emptyOnboardingState,
} from './onboarding.constants';
import { OnboardingState } from './onboarding.types';

export type OnboardingPatch = Partial<Omit<OnboardingState, 'version'>>;

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

export function mergeOnboardingState(
  current: OnboardingState,
  patch: OnboardingPatch,
): OnboardingState {
  const base = normalizeOnboardingState(current);

  return normalizeOnboardingState({
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
  });
}
