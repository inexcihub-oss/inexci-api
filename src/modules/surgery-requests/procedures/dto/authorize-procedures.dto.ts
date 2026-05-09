import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  ValidateNested,
  IsString,
  IsNotEmpty,
} from 'class-validator';

export class AuthorizeProcedureDto {
  @IsString()
  @IsNotEmpty()
  id: string;
  @IsNumber()
  @Type(() => Number)
  authorizedQuantity: number;
}
export class AuthorizeProceduresDto {
  @IsString()
  @IsNotEmpty()
  surgeryRequestId: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AuthorizeProcedureDto)
  surgery_request_procedures: AuthorizeProcedureDto[];
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AuthorizeProcedureDto)
  opmeItems: AuthorizeProcedureDto[];
}
