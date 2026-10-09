import { Injectable, PipeTransform } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { Mask } from '@tboerc/maskfy';

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

@Injectable()
export class PhoneMaskPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    return stripPhoneMask(value) as string;
  }
}
