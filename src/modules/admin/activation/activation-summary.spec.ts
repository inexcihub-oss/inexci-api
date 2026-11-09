import {
  buildAccountActivation,
  daysBetween,
  memberOnboarding,
  summarizeCohort,
  summarizeOnboarding,
} from './activation-summary';
import { UserStatus } from 'src/database/entities/user.entity';
import type { OnboardingState } from 'src/modules/onboarding/onboarding.types';

const signup = new Date('2026-10-01T12:00:00Z');
const at = (iso: string) => new Date(iso);

function row(over: Record<string, Date | null> = {}) {
  return {
    ownerId: 'o-1',
    signupAt: signup,
    firstPatientAt: null,
    firstAppointmentAt: null,
    firstSurgeryRequestAt: null,
    firstSentAt: null,
    firstWhatsappAt: null,
    ...over,
  };
}

function state(over: Partial<OnboardingState> = {}): OnboardingState {
  return {
    version: 1,
    status: 'in_progress',
    welcomeSeenAt: null,
    checklistDismissedAt: null,
    completedSteps: {},
    toursSeen: {},
    restartedAt: null,
    ...over,
  };
}

describe('activation-summary', () => {
  it('daysBetween conta dias inteiros e nunca fica negativo', () => {
    expect(daysBetween(signup, at('2026-10-03T11:00:00Z'))).toBe(1);
    expect(daysBetween(signup, at('2026-09-30T12:00:00Z'))).toBe(0);
    expect(daysBetween(signup, null)).toBeNull();
  });

  it('ativação é a primeira consulta ou SC, o que vier antes', () => {
    const result = buildAccountActivation(
      row({
        firstPatientAt: at('2026-10-02T12:00:00Z'),
        firstAppointmentAt: at('2026-10-06T12:00:00Z'),
        firstSurgeryRequestAt: at('2026-10-04T12:00:00Z'),
      }),
    );
    expect(result.activatedAt).toEqual(at('2026-10-04T12:00:00Z'));
    expect(result.daysToActivate).toBe(3);
    expect(result.milestones.map((m) => [m.key, m.daysFromSignup])).toEqual([
      ['first_patient', 1],
      ['first_appointment', 5],
      ['first_surgery_request', 3],
      ['first_sent_to_insurer', null],
      ['first_whatsapp', null],
    ]);
  });

  it('conta sem nenhuma consulta nem SC não está ativada', () => {
    const result = buildAccountActivation(
      row({ firstPatientAt: at('2026-10-02T12:00:00Z') }),
    );
    expect(result.activatedAt).toBeNull();
    expect(result.daysToActivate).toBeNull();
  });

  it('onboarding do usuário ignora chaves desconhecidas e trata estado vazio como não iniciado', () => {
    expect(memberOnboarding(null)).toEqual({
      status: 'not_started',
      completedSteps: 0,
      totalSteps: 12,
      toursSeen: 0,
      totalTours: 9,
    });
    expect(
      memberOnboarding(
        state({
          completedSteps: {
            'marcar-consulta': '2026-10-02T12:00:00Z',
            ['invalida' as never]: '2026-10-02T12:00:00Z',
          },
          toursSeen: { agenda: '2026-10-02T12:00:00Z' },
        }),
      ),
    ).toMatchObject({ status: 'in_progress', completedSteps: 1, toursSeen: 1 });
  });

  it('resumo da conta soma status, etapas (com a primeira data) e trilhas', () => {
    const summary = summarizeOnboarding([
      {
        userId: 'u-1',
        status: UserStatus.ACTIVE,
        onboardingState: state({
          status: 'completed',
          completedSteps: { 'marcar-consulta': '2026-10-05T12:00:00Z' },
          toursSeen: { agenda: '2026-10-05T12:00:00Z' },
        }),
      },
      {
        userId: 'u-2',
        status: UserStatus.ACTIVE,
        onboardingState: state({
          completedSteps: { 'marcar-consulta': '2026-10-03T12:00:00Z' },
        }),
      },
      { userId: 'u-3', status: UserStatus.PENDING, onboardingState: null },
    ]);
    expect(summary.members).toBe(3);
    expect(summary.byStatus).toEqual([
      { status: 'not_started', count: 1 },
      { status: 'in_progress', count: 1 },
      { status: 'dismissed', count: 0 },
      { status: 'completed', count: 1 },
    ]);
    expect(summary.steps.find((s) => s.key === 'marcar-consulta')).toEqual({
      key: 'marcar-consulta',
      completedBy: 2,
      firstCompletedAt: at('2026-10-03T12:00:00Z'),
    });
    expect(summary.steps).toHaveLength(12);
    expect(summary.tracks.find((t) => t.key === 'agenda')?.seenBy).toBe(1);
  });

  it('coorte: taxa, média e mediana só entre as contas ativadas', () => {
    const summary = summarizeCohort([
      row({
        firstPatientAt: at('2026-10-02T12:00:00Z'),
        firstAppointmentAt: at('2026-10-03T12:00:00Z'),
      }),
      row({ firstSurgeryRequestAt: at('2026-10-08T12:00:00Z') }),
      row({ firstPatientAt: at('2026-10-02T12:00:00Z') }),
      row(),
    ]);
    expect(summary).toEqual({
      cohortAccounts: 4,
      withFirstPatient: 2,
      activated: 2,
      activationRatePercent: 50,
      averageDaysToActivate: 4.5,
      medianDaysToActivate: 4.5,
    });
  });

  it('coorte vazia não divide por zero', () => {
    expect(summarizeCohort([])).toEqual({
      cohortAccounts: 0,
      withFirstPatient: 0,
      activated: 0,
      activationRatePercent: null,
      averageDaysToActivate: null,
      medianDaysToActivate: null,
    });
  });
});
