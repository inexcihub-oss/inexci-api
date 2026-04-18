import { IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { FindManySharedDto } from 'src/shared/dto/find-many.dto';

export class FindManyCidDto extends FindManySharedDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Max(100)
  @Min(1)
  @Transform(({ value }) => (value ? +value : 50))
  declare take?: number;
}
