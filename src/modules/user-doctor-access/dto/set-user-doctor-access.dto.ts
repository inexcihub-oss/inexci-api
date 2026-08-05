import { IsArray, IsUUID } from 'class-validator';

/**
 * Corpo de `PUT /user-doctor-access/:userId`.
 *
 * A rota antes tipava o corpo inline (`{ doctor_user_ids: string[] }`), sem
 * DTO: como o `ValidationPipe` não tinha classe para validar, um corpo vazio
 * chegava ao service como `undefined` e estourava em 500. Com o DTO, entrada
 * inválida vira 400 antes de tocar o banco.
 *
 * Lista vazia é válida de propósito — é assim que se removem todos os vínculos
 * de um colaborador.
 */
export class SetUserDoctorAccessDto {
  @IsArray()
  @IsUUID('4', { each: true })
  doctor_user_ids: string[];
}
