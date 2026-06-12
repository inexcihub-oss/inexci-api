import { applyDecorators } from '@nestjs/common';
import { Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Política canônica de senha forte (espelha o frontend `passwordChecks`):
 * - mínimo 8 caracteres (máximo 128)
 * - ao menos 1 letra maiúscula
 * - ao menos 1 letra minúscula
 * - ao menos 1 número
 * - ao menos 1 caractere especial
 */
export const STRONG_PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/;

export const STRONG_PASSWORD_MESSAGE =
  'A senha deve ter no mínimo 8 caracteres, incluindo maiúscula, minúscula, número e caractere especial.';

/**
 * Aplica a política de senha forte a uma propriedade de DTO.
 * Combina MinLength/MaxLength (mensagens de tamanho mais claras) com o regex
 * de composição.
 */
export function IsStrongPassword(): PropertyDecorator {
  return applyDecorators(
    MinLength(8, { message: STRONG_PASSWORD_MESSAGE }),
    MaxLength(128, { message: STRONG_PASSWORD_MESSAGE }),
    Matches(STRONG_PASSWORD_REGEX, { message: STRONG_PASSWORD_MESSAGE }),
  );
}
