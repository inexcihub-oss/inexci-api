import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  ValidateNested,
  IsNotEmpty,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class AuthorizeProcedureDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;
  @IsNumber()
  @Type(() => Number)
  authorizedQuantity: number;
}

export class AuthorizeOpmeItemDto extends AuthorizeProcedureDto {
  @IsOptional()
  @IsUUID('4')
  selectedSupplierId?: string;
}

export class AuthorizeProceduresDto {
  @IsUUID()
  @IsNotEmpty()
  surgeryRequestId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AuthorizeProcedureDto)
  surgeryRequestProcedures: AuthorizeProcedureDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AuthorizeOpmeItemDto)
  opmeItems: AuthorizeOpmeItemDto[];
}
