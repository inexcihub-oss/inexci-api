import { Transform } from 'class-transformer';
import { IsOptional, IsUUID } from 'class-validator';
import { FindManySharedDto } from 'src/shared/dto/find-many.dto';

export class FindManySurgeryRequestDto extends FindManySharedDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'all' || !value) return undefined;
    return value.split(',').map((item: string) => parseInt(item));
  })
  status?: number[];

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  hospitalId?: string;

  @IsOptional()
  @IsUUID()
  healthPlanId?: string;

  @IsOptional()
  @IsUUID()
  doctorId?: string;
}
