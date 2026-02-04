import { Type, Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsDateString } from 'class-validator';
import { SurgeryRequestPriority } from '../../../database/entities';

export class UpdateSurgeryRequestBasicDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  priority?: SurgeryRequestPriority;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsString()
  manager_id?: string;
}
