import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO para criar um novo tipo de procedimento cirúrgico.
 * Não possui código TUSS — os itens TUSS ficam em SurgeryRequestTussItem.
 */
export class CreateProcedureDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}
