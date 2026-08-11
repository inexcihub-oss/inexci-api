import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsArray,
  ValidateNested,
} from 'class-validator';

export class ProcedureItemDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  /**
   * Campo morto: `ProceduresService.create` nunca o lê — o id do item é
   * gerado pelo banco e o código TUSS vem de `tuss.json`, que não tem uuid.
   * Validá-lo como uuid fazia o payload inteiro voltar 400 quando o cliente
   * mandava o próprio código aqui. Segue aceito como string livre só para não
   * quebrar bundle antigo em cache (`forbidNonWhitelisted: true` recusaria a
   * propriedade); nenhum caminho do frontend o envia mais.
   */
  @IsOptional()
  @IsString()
  procedureId?: string;

  @IsString()
  @IsNotEmpty()
  tussCode: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @Type(() => Number)
  @IsNumber()
  quantity: number;
}

export class CreateSurgeryRequestProcedureDto {
  @IsUUID()
  @IsNotEmpty()
  surgeryRequestId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcedureItemDto)
  procedures: ProcedureItemDto[];
}
