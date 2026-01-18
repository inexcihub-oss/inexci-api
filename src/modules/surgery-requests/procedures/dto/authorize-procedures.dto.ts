import { Type } from 'class-transformer';
import { IsArray, IsNumber, ValidateNested } from 'class-validator';

export class AuthorizeProcedureDto {
  @IsNumber()
  @Type(() => Number)
  id: number;

  @IsNumber()
  @Type(() => Number)
  authorized_quantity: number;
}

export class AuthorizeProceduresDto {
  @IsNumber()
  @Type(() => Number)
  surgery_request_id: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AuthorizeProcedureDto)
  surgery_request_procedures: AuthorizeProcedureDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AuthorizeProcedureDto)
  opme_items: AuthorizeProcedureDto[];
}
