import {
  ONBOARDING_STATE_VERSION,
  ONBOARDING_STEP_KEYS,
  ONBOARDING_TRACK_IDS,
  emptyOnboardingState,
} from './onboarding.constants';

describe('onboarding.constants', () => {
  it('parte de um estado vazio e versionado', () => {
    const estado = emptyOnboardingState();

    expect(estado.version).toBe(ONBOARDING_STATE_VERSION);
    expect(estado.status).toBe('not_started');
    expect(estado.welcomeSeenAt).toBeNull();
    expect(estado.checklistDismissedAt).toBeNull();
    expect(estado.restartedAt).toBeNull();
    expect(estado.completedSteps).toEqual({});
    expect(estado.toursSeen).toEqual({});
  });

  it('devolve um objeto novo a cada chamada', () => {
    const a = emptyOnboardingState();
    const b = emptyOnboardingState();

    a.completedSteps['criar-solicitacao'] = '2026-08-21T00:00:00.000Z';

    expect(b.completedSteps).toEqual({});
  });

  it('não tem chave duplicada nas listas de whitelist', () => {
    expect(new Set(ONBOARDING_STEP_KEYS).size).toBe(
      ONBOARDING_STEP_KEYS.length,
    );
    expect(new Set(ONBOARDING_TRACK_IDS).size).toBe(
      ONBOARDING_TRACK_IDS.length,
    );
  });
});
