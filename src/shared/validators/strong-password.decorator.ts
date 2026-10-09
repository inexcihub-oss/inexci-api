import { applyDecorators } from '@nestjs/common';
import { Matches, MaxLength, MinLength } from 'class-validator';

export const STRONG_PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/;

export const STRONG_PASSWORD_MESSAGE =
  'A senha deve ter no mínimo 8 caracteres, incluindo maiúscula, minúscula, número e caractere especial.';

export function IsStrongPassword(): PropertyDecorator {
  return applyDecorators(
    MinLength(8, { message: STRONG_PASSWORD_MESSAGE }),
    MaxLength(128, { message: STRONG_PASSWORD_MESSAGE }),
    Matches(STRONG_PASSWORD_REGEX, { message: STRONG_PASSWORD_MESSAGE }),
  );
}
