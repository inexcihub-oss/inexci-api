import {
  ActivationMilestonesRow,
  MemberOnboardingRow,
} from 'src/database/repositories/admin-activation.repository';
import {
  ONBOARDING_STEP_KEYS,
  ONBOARDING_TRACK_IDS,
} from 'src/modules/onboarding/onboarding.constants';
import type {
  OnboardingState,
  OnboardingStatus,
  StepKey,
  TrackId,
} from 'src/modules/onboarding/onboarding.types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const ACTIVATION_MILESTONE_KEYS = [
  'first_patient',
  'first_appointment',
  'first_surgery_request',
  'first_sent_to_insurer',
  'first_whatsapp',
] as const;

export type ActivationMilestoneKey = (typeof ACTIVATION_MILESTONE_KEYS)[number];

export const ONBOARDING_STATUSES: readonly OnboardingStatus[] = [
  'not_started',
  'in_progress',
  'dismissed',
  'completed',
];

export interface ActivationMilestone {
  key: ActivationMilestoneKey;
  at: Date | null;
  daysFromSignup: number | null;
}

export interface AccountActivation {
  signupAt: Date;
  activatedAt: Date | null;
  daysToActivate: number | null;
  milestones: ActivationMilestone[];
}

export interface OnboardingStepSummary {
  key: StepKey;
  completedBy: number;
  firstCompletedAt: Date | null;
}

export interface OnboardingTrackSummary {
  key: TrackId;
  seenBy: number;
}

export interface AccountOnboardingSummary {
  members: number;
  byStatus: Array<{ status: OnboardingStatus; count: number }>;
  steps: OnboardingStepSummary[];
  tracks: OnboardingTrackSummary[];
}

export interface MemberOnboarding {
  status: OnboardingStatus;
  completedSteps: number;
  totalSteps: number;
  toursSeen: number;
  totalTours: number;
}

export interface ActivationCohortSummary {
  cohortAccounts: number;
  withFirstPatient: number;
  activated: number;
  activationRatePercent: number | null;
  averageDaysToActivate: number | null;
  medianDaysToActivate: number | null;
}

export function daysBetween(from: Date, to: Date | null): number | null {
  if (!to) return null;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY));
}

function earliest(...dates: Array<Date | null>): Date | null {
  return dates.reduce<Date | null>(
    (min, d) => (d && (!min || d < min) ? d : min),
    null,
  );
}

export function buildAccountActivation(
  row: ActivationMilestonesRow,
): AccountActivation {
  const at: Record<ActivationMilestoneKey, Date | null> = {
    first_patient: row.firstPatientAt,
    first_appointment: row.firstAppointmentAt,
    first_surgery_request: row.firstSurgeryRequestAt,
    first_sent_to_insurer: row.firstSentAt,
    first_whatsapp: row.firstWhatsappAt,
  };
  const activatedAt = earliest(
    row.firstAppointmentAt,
    row.firstSurgeryRequestAt,
  );
  return {
    signupAt: row.signupAt,
    activatedAt,
    daysToActivate: daysBetween(row.signupAt, activatedAt),
    milestones: ACTIVATION_MILESTONE_KEYS.map((key) => ({
      key,
      at: at[key],
      daysFromSignup: daysBetween(row.signupAt, at[key]),
    })),
  };
}

function statusOf(state: OnboardingState | null): OnboardingStatus {
  return state?.status && ONBOARDING_STATUSES.includes(state.status)
    ? state.status
    : 'not_started';
}

function knownKeys<K extends string>(
  record: Partial<Record<K, string>> | null | undefined,
  allowed: readonly K[],
): K[] {
  if (!record || typeof record !== 'object') return [];
  return allowed.filter((key) => typeof record[key] === 'string');
}

export function memberOnboarding(
  state: OnboardingState | null,
): MemberOnboarding {
  return {
    status: statusOf(state),
    completedSteps: knownKeys(state?.completedSteps, ONBOARDING_STEP_KEYS)
      .length,
    totalSteps: ONBOARDING_STEP_KEYS.length,
    toursSeen: knownKeys(state?.toursSeen, ONBOARDING_TRACK_IDS).length,
    totalTours: ONBOARDING_TRACK_IDS.length,
  };
}

export function summarizeOnboarding(
  members: MemberOnboardingRow[],
): AccountOnboardingSummary {
  const statusCount = new Map<OnboardingStatus, number>();
  const steps = new Map<StepKey, OnboardingStepSummary>(
    ONBOARDING_STEP_KEYS.map((key) => [
      key,
      { key, completedBy: 0, firstCompletedAt: null },
    ]),
  );
  const tracks = new Map<TrackId, number>();

  for (const member of members) {
    const state = member.onboardingState;
    const status = statusOf(state);
    statusCount.set(status, (statusCount.get(status) ?? 0) + 1);
    for (const key of knownKeys(state?.completedSteps, ONBOARDING_STEP_KEYS)) {
      const step = steps.get(key)!;
      step.completedBy += 1;
      const when = new Date(state!.completedSteps[key]!);
      if (
        !Number.isNaN(when.getTime()) &&
        (!step.firstCompletedAt || when < step.firstCompletedAt)
      ) {
        step.firstCompletedAt = when;
      }
    }
    for (const key of knownKeys(state?.toursSeen, ONBOARDING_TRACK_IDS)) {
      tracks.set(key, (tracks.get(key) ?? 0) + 1);
    }
  }

  return {
    members: members.length,
    byStatus: ONBOARDING_STATUSES.map((status) => ({
      status,
      count: statusCount.get(status) ?? 0,
    })),
    steps: [...steps.values()],
    tracks: ONBOARDING_TRACK_IDS.map((key) => ({
      key,
      seenBy: tracks.get(key) ?? 0,
    })),
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

export function summarizeCohort(
  rows: ActivationMilestonesRow[],
): ActivationCohortSummary {
  const days = rows
    .map((row) => buildAccountActivation(row).daysToActivate)
    .filter((d): d is number => d !== null);
  const activated = days.length;
  return {
    cohortAccounts: rows.length,
    withFirstPatient: rows.filter((r) => r.firstPatientAt).length,
    activated,
    activationRatePercent: rows.length
      ? Math.round((activated / rows.length) * 1000) / 10
      : null,
    averageDaysToActivate: activated
      ? Math.round((days.reduce((a, b) => a + b, 0) / activated) * 10) / 10
      : null,
    medianDaysToActivate: median(days),
  };
}
