import { Type, Transform } from 'class-transformer';
import { IsOptional, IsString, IsDateString } from 'class-validator';
import { SurgeryRequestPriority } from 'src/database/entities';

export class UpdateSurgeryRequestBasicDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  @Type(() => Number)
  priority?: SurgeryRequestPriority;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsString()
  manager_id?: string;
}
