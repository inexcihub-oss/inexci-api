import { IsOptional, IsString, MaxLength } from 'class-validator';
import { FindManySharedDto } from 'src/shared/dto/find-many.dto';

export class FindManyPatientDto extends FindManySharedDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
