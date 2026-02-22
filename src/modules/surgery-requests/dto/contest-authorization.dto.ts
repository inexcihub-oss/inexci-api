import { IsIn, IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * POST /surgery-requests/:id/contest-authorization
 * IN_ANALYSIS → IN_ANALYSIS (não muda status, registra contestação)
 */
export class ContestAuthorizationDto {
  @IsString()
  reason: string;

  @IsIn(['email', 'document'])
  method: 'email' | 'document';

  @ValidateIf((o) => o.method === 'email')
  @IsString()
  to?: string;

  @ValidateIf((o) => o.method === 'email')
  @IsString()
  subject?: string;

  @ValidateIf((o) => o.method === 'email')
  @IsString()
  message?: string;

  @IsOptional()
  @IsString({ each: true })
  attachments?: string[];
}
