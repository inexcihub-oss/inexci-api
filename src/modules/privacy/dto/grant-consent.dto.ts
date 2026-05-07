import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength } from 'class-validator';

const TYPES = ['ai', 'privacy_policy', 'terms_of_use'] as const;

export class GrantConsentDto {
  @ApiProperty({
    enum: TYPES,
    description: 'Tipo de consentimento a registrar.',
  })
  @IsIn(TYPES as unknown as string[])
  type: (typeof TYPES)[number];

  @ApiProperty({
    description:
      'Versão do termo aceito (deve coincidir com a versão atual exposta em /privacy/policy/:slug).',
    example: '1.0',
  })
  @IsString()
  @MaxLength(20)
  version: string;
}
