import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateSurgeryRequestProcedureDto {
  @IsString()
  @IsNotEmpty()
  surgery_request_id: string;
  procedures: {
    id: string;
    procedure_id: string;
    quantity: number;
  }[];
}
