import { BadRequestException, PipeTransform } from '@nestjs/common';

export class JobIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[\w:.-]{1,200}$/.test(value)) {
      throw new BadRequestException('Identificador de tarefa inválido');
    }
    return value;
  }
}
