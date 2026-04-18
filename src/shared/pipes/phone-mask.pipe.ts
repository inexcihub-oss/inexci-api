import { Injectable, PipeTransform } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { Mask } from '@tboerc/maskfy';

/** Remove a máscara de um campo de telefone escalar */
export function stripPhoneMask(value: string | null | undefined): string | null | undefined {
  return value ? Mask.phone.raw(value) : value;
}

/** Remove a máscara do campo `phone` de um objeto aninhado */
export function stripObjectPhoneMask<T extends { phone?: string }>(value: T | null | undefined): T | null | undefined {
  if (value?.phone) {
    value.phone = Mask.phone.raw(value.phone);
  }
  return value;
}

/** Decorator para aplicar diretamente em propriedades de DTO com campo de telefone escalar */
export function PhoneTransform() {
  return Transform(({ value }) => stripPhoneMask(value));
}

/** Pipe NestJS para remover máscara de telefone de parâmetros individuais */
@Injectable()
export class PhoneMaskPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    return stripPhoneMask(value) as string;
  }
}
