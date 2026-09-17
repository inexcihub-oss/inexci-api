import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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

  /**
   * O convênio aprovou alguém fora dos cotados. Grava o fornecedor genérico
   * "Outro" da conta — que o cliente não precisa (nem consegue) descobrir o id,
   * já que ele fica escondido do catálogo.
   */
  @IsOptional()
  @IsBoolean()
  selectedSupplierIsGeneric?: boolean;
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
