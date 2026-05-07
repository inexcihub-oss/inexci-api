import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

const TYPES = ['ai', 'privacy_policy', 'terms_of_use'] as const;

export class RevokeConsentDto {
  @ApiProperty({
    enum: TYPES,
    description:
      'Tipo de consentimento a revogar. Revogar privacy_policy/terms_of_use bloqueia o uso da plataforma na próxima requisição autenticada.',
  })
  @IsIn(TYPES as unknown as string[])
  type: (typeof TYPES)[number];
}
