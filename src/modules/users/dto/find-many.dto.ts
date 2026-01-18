import { Type } from 'class-transformer';
import { IsNumber, IsOptional } from 'class-validator';
import { FindManySharedDto } from 'src/shared/dto/find-many.dto';

export class FindManyUsersDto extends FindManySharedDto {
  @IsNumber()
  @Type(() => Number)
  pv: number;
}
