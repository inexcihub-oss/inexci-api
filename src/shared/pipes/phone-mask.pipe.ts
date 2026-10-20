import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { Mask } from '@tboerc/maskfy';
import {
  TELEFONE_BR_CANONICO,
  TELEFONE_INVALIDO_MENSAGEM,
  canonicalizarTelefone,
} from '../utils/phone.util';

export function stripPhoneMask(
  value: string | null | undefined,
): string | null | undefined {
  return value ? Mask.phone.raw(value) : value;
}

export function stripObjectPhoneMask<T extends { phone?: string }>(
  value: T | null | undefined,
): T | null | undefined {
  if (value?.phone) {
    value.phone = Mask.phone.raw(value.phone);
  }
  return value;
}

export function PhoneTransform() {
  return Transform(({ value }) => stripPhoneMask(value));
}

export function normalizarTelefoneDeUsuario(valor: unknown): unknown {
  if (typeof valor !== 'string') return valor;
  if (valor.trim() === '') return undefined;
  return canonicalizarTelefone(valor) ?? valor;
}

export function UserPhone(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }) => normalizarTelefoneDeUsuario(value)),
    Matches(TELEFONE_BR_CANONICO, { message: TELEFONE_INVALIDO_MENSAGEM }),
  );
}
