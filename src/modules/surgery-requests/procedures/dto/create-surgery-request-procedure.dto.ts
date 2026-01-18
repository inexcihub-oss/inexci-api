import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class CreateSurgeryRequestProcedureDto {
  @IsNumber()
  @Type(() => Number)
  surgery_request_id: number;

  @IsNotEmpty()
  procedures: {
    id: number;
    procedure_id: number;
    quantity: number;
  }[]

}
