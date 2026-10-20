import { IsOptional, IsString } from 'class-validator';

export class CloseSurgeryRequestDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
