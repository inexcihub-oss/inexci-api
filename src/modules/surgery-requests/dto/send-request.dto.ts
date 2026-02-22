import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

/**
 * POST /surgery-requests/:id/send
 * Transição: PENDING → SENT
 */
export class SendRequestDto {
  @IsIn(['email', 'download'])
  method: 'email' | 'download';

  @ValidateIf((o) => o.method === 'email')
  @IsOptional()
  @IsString()
  to?: string;

  @ValidateIf((o) => o.method === 'email')
  @IsOptional()
  @IsString()
  subject?: string;

  @ValidateIf((o) => o.method === 'email')
  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString({ each: true })
  attachments?: string[];
}
