import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

function HasExplicitTime(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    type Constructor = abstract new (...args: unknown[]) => unknown;

    registerDecorator({
      name: 'hasExplicitTime',
      target: (object as { constructor: Constructor }).constructor,
      propertyName,
      options: {
        message:
          'Todas as opções de data devem incluir um horário definido (não pode ser meia-noite).',
        ...validationOptions,
      },
      validator: {
        validate(value: unknown): boolean {
          if (!Array.isArray(value)) return false;
          return value.every((iso: unknown) => {
            if (typeof iso !== 'string') return false;
            const d = new Date(iso);
            if (isNaN(d.getTime())) return false;
            // Rejeita datas que chegam sem componente de tempo (somente data)
            if (!iso.includes('T')) return false;
            // Rejeita meia-noite UTC — sentinela de horário não preenchido
            return (
              d.getUTCHours() !== 0 ||
              d.getUTCMinutes() !== 0 ||
              d.getUTCSeconds() !== 0
            );
          });
        },
      },
    });
  };
}

/**
 * POST /surgery-requests/:id/accept-authorization
 * Transição: IN_ANALYSIS → IN_SCHEDULING
 */
export class AcceptAuthorizationDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  notifyPatient?: boolean;

  /**
   * Datas opcionais (até 3). Se informadas, cada uma precisa ter horário
   * explícito. Podem ser definidas depois, já em Agendamento (o pendency
   * bloqueante `schedule_dates` garante as datas antes de ir para Agendada).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsDateString({}, { each: true })
  @HasExplicitTime()
  dateOptions?: string[];
}
