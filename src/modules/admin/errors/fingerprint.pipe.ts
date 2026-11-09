import { BadRequestException, PipeTransform } from '@nestjs/common';

export class FingerprintPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[0-9a-f]{64}$/.test(value)) {
      throw new BadRequestException('Identificador de erro inválido');
    }
    return value;
  }
}
