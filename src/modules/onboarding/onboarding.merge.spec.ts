import { emptyOnboardingState } from './onboarding.constants';
import {
  mergeOnboardingState,
  normalizeOnboardingState,
  type OnboardingPatch,
} from './onboarding.merge';

describe('normalizeOnboardingState', () => {
  it('trata null como estado vazio', () => {
    expect(normalizeOnboardingState(null)).toEqual(emptyOnboardingState());
  });

  it('completa campos ausentes de um estado gravado por versão anterior', () => {
    const normalizado = normalizeOnboardingState({
      version: 1,
      status: 'in_progress',
      welcomeSeenAt: '2026-08-01T00:00:00.000Z',
    });

    expect(normalizado.status).toBe('in_progress');
    expect(normalizado.welcomeSeenAt).toBe('2026-08-01T00:00:00.000Z');
    expect(normalizado.completedSteps).toEqual({});
    expect(normalizado.toursSeen).toEqual({});
    expect(normalizado.checklistDismissedAt).toBeNull();
  });
});

describe('mergeOnboardingState', () => {
  it('preserva chaves ausentes do patch', () => {
    const atual = {
      ...emptyOnboardingState(),
      status: 'in_progress' as const,
      welcomeSeenAt: '2026-08-01T00:00:00.000Z',
    };

    const proximo = mergeOnboardingState(atual, {
      checklistDismissedAt: '2026-08-02T00:00:00.000Z',
    });

    expect(proximo.welcomeSeenAt).toBe('2026-08-01T00:00:00.000Z');
    expect(proximo.status).toBe('in_progress');
    expect(proximo.checklistDismissedAt).toBe('2026-08-02T00:00:00.000Z');
  });

  it('funde completedSteps em vez de substituir', () => {
    const atual = {
      ...emptyOnboardingState(),
      completedSteps: { 'criar-solicitacao': '2026-08-01T00:00:00.000Z' },
    };

    const proximo = mergeOnboardingState(atual, {
      completedSteps: { 'enviar-solicitacao': '2026-08-02T00:00:00.000Z' },
    });

    expect(proximo.completedSteps).toEqual({
      'criar-solicitacao': '2026-08-01T00:00:00.000Z',
      'enviar-solicitacao': '2026-08-02T00:00:00.000Z',
    });
  });

  it('funde toursSeen em vez de substituir', () => {
    const atual = {
      ...emptyOnboardingState(),
      toursSeen: { solicitacoes: '2026-08-01T00:00:00.000Z' },
    };

    const proximo = mergeOnboardingState(atual, {
      toursSeen: { agenda: '2026-08-02T00:00:00.000Z' },
    });

    expect(proximo.toursSeen).toEqual({
      solicitacoes: '2026-08-01T00:00:00.000Z',
      agenda: '2026-08-02T00:00:00.000Z',
    });
  });

  it('refazer um passo sobrescreve a data, sem duplicar', () => {
    const atual = {
      ...emptyOnboardingState(),
      completedSteps: { 'criar-solicitacao': '2026-08-01T00:00:00.000Z' },
    };

    const proximo = mergeOnboardingState(atual, {
      completedSteps: { 'criar-solicitacao': '2026-08-09T00:00:00.000Z' },
    });

    expect(proximo.completedSteps).toEqual({
      'criar-solicitacao': '2026-08-09T00:00:00.000Z',
    });
  });

  it('não deixa o cliente rebaixar a versão do estado', () => {
    const atual = { ...emptyOnboardingState(), version: 1 };

    const proximo = mergeOnboardingState(atual, {
      status: 'in_progress',
      version: 99,
    } as unknown as OnboardingPatch);

    expect(proximo.version).toBe(1);
  });

  it('normaliza status: null em vez de persistir um valor fora do enum', () => {
    const atual = { ...emptyOnboardingState(), status: 'in_progress' as const };

    const proximo = mergeOnboardingState(atual, {
      status: null,
    } as unknown as OnboardingPatch);

    expect(proximo.status).toBe('not_started');
  });

  it('não muta o estado recebido', () => {
    const atual = emptyOnboardingState();

    mergeOnboardingState(atual, {
      completedSteps: { 'criar-solicitacao': '2026-08-02T00:00:00.000Z' },
    });

    expect(atual.completedSteps).toEqual({});
  });
});
