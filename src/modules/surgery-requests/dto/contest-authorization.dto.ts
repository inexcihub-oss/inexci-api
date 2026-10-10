import { IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';
import { SendMethod } from 'src/shared/constants/send-method';

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
  @IsString()
  cc?: string;

  @IsOptional()
  @IsString({ each: true })
  attachments?: string[];
}
