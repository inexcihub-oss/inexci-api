import { Transform } from 'class-transformer';
import { IsOptional } from 'class-validator';
import { FindManySharedDto } from 'src/shared/dto/find-many.dto';

export class FindManySurgeryRequestDto extends FindManySharedDto {
  @IsOptional()
  @Transform(({ value }) => value.split(',').map((item) => parseInt(item)))
  status?: number[];
}
