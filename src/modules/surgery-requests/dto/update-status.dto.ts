import { Type } from 'class-transformer';
import { IsNumber, Min, Max, IsInt } from 'class-validator';

export class UpdateStatusDto {
  @Type(() => Number)
  @IsInt({ message: 'Status must be an integer' })
  @IsNumber({}, { message: 'Status must be a number' })
  @Min(1, { message: 'Status must be at least 1' })
  @Max(10, { message: 'Status must be at most 10' })
  status: number;
}

