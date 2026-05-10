import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSurgeryRequestProcedureDto {
  @ApiProperty({ description: 'Nova quantidade solicitada', example: 2 })
  @IsInt()
  @Min(1)
  quantity: number;
}
