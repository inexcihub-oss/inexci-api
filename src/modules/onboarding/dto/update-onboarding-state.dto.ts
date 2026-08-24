import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
 * `version` e `restartedAt` são do servidor e nunca vêm do cliente — mas
 * estão DECLARADOS aqui, com `@Exclude()`, e isso é deliberado. O pipe
 * global roda com `forbidNonWhitelisted: true`: um cliente que devolva o
 * `OnboardingState` inteiro que recebeu do GET (que carrega os dois campos)
 * tomaria 400 se algum deles virasse propriedade própria da instância — é
 * exatamente o que o frontend faz (`OnboardingProvider.tsx` manda o estado
 * inteiro menos `version`, o que inclui `restartedAt`). O `@Exclude()`
 * remove os dois antes da transformação, então são ignorados em silêncio em
 * vez de rejeitarem a requisição. Não remova nenhum dos dois campos por
 * parecerem mortos.
 *
 * Esse truque só funciona porque `tsconfig.json` mira ES2021, o que deixa
 * `useDefineForClassFields` desligado por padrão — a declaração não emite
 * `Object.defineProperty` e o campo nunca vira propriedade própria da
 * instância. Subir o target para ES2022 reativa isso e os dois campos
 * voltam a existir na instância, e todo PATCH volta a tomar 400.
 */
export class UpdateOnboardingStateDto {
  // `@ApiHideProperty()` não é enfeite: o plugin do Swagger (`nest-cli.json`,
  // `introspectComments`) gera metadata para toda propriedade de `*.dto.ts`, e
  // um campo tipado `undefined` não tem tipo que ele consiga resolver — o
  // `SchemaObjectFactory` interpreta como dependência circular e DERRUBA o boot
  // da API. Sem esta linha, o backend não sobe.
  @ApiHideProperty()
  @Exclude()
  version?: undefined;

  @ApiHideProperty()
  @Exclude()
  restartedAt?: undefined;

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
