import { ApiProperty } from '@nestjs/swagger';
import {
  ONBOARDING_STEP_KEYS,
  ONBOARDING_TRACK_IDS,
} from 'src/modules/onboarding/onboarding.constants';
import type {
  OnboardingStatus,
  StepKey,
  TrackId,
} from 'src/modules/onboarding/onboarding.types';
import {
  ACTIVATION_MILESTONE_KEYS,
  ActivationMilestoneKey,
  ONBOARDING_STATUSES,
} from '../activation-summary';

const nullableDate = {
  type: String,
  format: 'date-time',
  nullable: true,
} as const;

export class AdminActivationMilestoneDto {
  @ApiProperty({ enum: ACTIVATION_MILESTONE_KEYS })
  key: ActivationMilestoneKey;
  @ApiProperty(nullableDate) at: Date | null;
  @ApiProperty({ type: Number, nullable: true })
  daysFromSignup: number | null;
}

export class AdminOnboardingStatusCountDto {
  @ApiProperty({ enum: ONBOARDING_STATUSES }) status: OnboardingStatus;
  @ApiProperty() count: number;
}

export class AdminOnboardingStepDto {
  @ApiProperty({ enum: ONBOARDING_STEP_KEYS }) key: StepKey;
  @ApiProperty() completedBy: number;
  @ApiProperty(nullableDate) firstCompletedAt: Date | null;
}

export class AdminOnboardingTrackDto {
  @ApiProperty({ enum: ONBOARDING_TRACK_IDS }) key: TrackId;
  @ApiProperty() seenBy: number;
}

export class AdminAccountOnboardingDto {
  @ApiProperty() members: number;
  @ApiProperty({ type: [AdminOnboardingStatusCountDto] })
  byStatus: AdminOnboardingStatusCountDto[];
  @ApiProperty({ type: [AdminOnboardingStepDto] })
  steps: AdminOnboardingStepDto[];
  @ApiProperty({ type: [AdminOnboardingTrackDto] })
  tracks: AdminOnboardingTrackDto[];
}

export class AdminAccountActivationDto {
  @ApiProperty({ type: String, format: 'date-time' }) signupAt: Date;
  @ApiProperty({
    ...nullableDate,
    description: 'Primeira consulta ou primeira SC, o que vier antes',
  })
  activatedAt: Date | null;
  @ApiProperty({ type: Number, nullable: true })
  daysToActivate: number | null;
  @ApiProperty({ type: [AdminActivationMilestoneDto] })
  milestones: AdminActivationMilestoneDto[];
  @ApiProperty({ type: AdminAccountOnboardingDto })
  onboarding: AdminAccountOnboardingDto;
}

export class AdminMemberOnboardingDto {
  @ApiProperty({ enum: ONBOARDING_STATUSES }) status: OnboardingStatus;
  @ApiProperty() completedSteps: number;
  @ApiProperty() totalSteps: number;
  @ApiProperty() toursSeen: number;
  @ApiProperty() totalTours: number;
}

export class AdminMemberUsageDto {
  @ApiProperty() surgeryRequests: number;
  @ApiProperty() appointments: number;
  @ApiProperty() recordsFinalized: number;
  @ApiProperty() assistantMessages: number;
  @ApiProperty() aiCostUsdCents: number;
}

export class AdminMetricsActivationDto {
  @ApiProperty({ description: 'Contas cliente cadastradas no período' })
  cohortAccounts: number;
  @ApiProperty() withFirstPatient: number;
  @ApiProperty({ description: 'Com primeira consulta ou SC' })
  activated: number;
  @ApiProperty({ type: Number, nullable: true })
  activationRatePercent: number | null;
  @ApiProperty({ type: Number, nullable: true })
  averageDaysToActivate: number | null;
  @ApiProperty({ type: Number, nullable: true })
  medianDaysToActivate: number | null;
}
