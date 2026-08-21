import { ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import {
  ONBOARDING_STATUSES,
  ONBOARDING_STEP_KEYS,
  ONBOARDING_TRACK_IDS,
} from '../onboarding.constants';
import { OnboardingStatus, StepKey, TrackId } from '../onboarding.types';
import { IsTimestampMapOf } from '../validators/is-timestamp-map-of.validator';

/**
 * Patch parcial do estado de onboarding. Campo ausente é preservado pelo
 * merge — este DTO só descreve o que PODE mudar.
 *
 * `version` é do servidor e nunca vem do cliente — mas está DECLARADO aqui,
 * com `@Exclude()`, e isso é deliberado. O pipe global roda com
 * `forbidNonWhitelisted: true`: um cliente que devolva o `OnboardingState`
 * que recebeu do GET (que carrega `version`) tomaria 400 se o campo virasse
 * propriedade própria da instância. O `@Exclude()` o remove antes da
 * transformação, então ele é ignorado em silêncio em vez de rejeitar a
 * requisição. Não remova o campo por parecer morto.
 */
export class UpdateOnboardingStateDto {
  @Exclude()
  version?: undefined;
  @ApiPropertyOptional({ enum: ONBOARDING_STATUSES as unknown as string[] })
  @IsOptional()
  @IsIn(ONBOARDING_STATUSES as unknown as string[])
  status?: OnboardingStatus;

  @ApiPropertyOptional({ example: '2026-08-21T14:02:11.000Z' })
  @IsOptional()
  @IsISO8601()
  welcomeSeenAt?: string | null;

  @ApiPropertyOptional({ example: '2026-08-21T14:20:00.000Z' })
  @IsOptional()
  @IsISO8601()
  checklistDismissedAt?: string | null;

  @ApiPropertyOptional({
    description: 'Mapa passo → timestamp ISO. Só chaves conhecidas.',
  })
  @IsOptional()
  @IsTimestampMapOf(ONBOARDING_STEP_KEYS)
  completedSteps?: Partial<Record<StepKey, string>>;

  @ApiPropertyOptional({
    description: 'Mapa trilha → timestamp ISO. Só chaves conhecidas.',
  })
  @IsOptional()
  @IsTimestampMapOf(ONBOARDING_TRACK_IDS)
  toursSeen?: Partial<Record<TrackId, string>>;
}
