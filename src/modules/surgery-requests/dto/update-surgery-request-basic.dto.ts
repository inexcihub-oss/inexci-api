import { Type, Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
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
  @IsString()
  hospitalId?: string | null;

  @IsOptional()
  @IsString()
  healthPlanId?: string | null;
}
