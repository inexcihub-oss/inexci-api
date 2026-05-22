import { IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';
import { SendMethod } from 'src/shared/constants/send-method';

/**
 * POST /surgery-requests/:id/contest-authorization
 * IN_ANALYSIS → IN_ANALYSIS (não muda status, registra contestação)
 */
export class ContestAuthorizationDto {
  @IsString()
  reason: string;

  @IsEnum(SendMethod)
  method: SendMethod;

  @ValidateIf((o) => o.method === SendMethod.EMAIL)
  @IsString()
  to?: string;

  @ValidateIf((o) => o.method === SendMethod.EMAIL)
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString({ each: true })
  attachments?: string[];
}
