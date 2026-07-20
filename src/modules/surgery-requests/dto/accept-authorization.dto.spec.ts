import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AcceptAuthorizationDto } from './accept-authorization.dto';

const validDateOptions = [
  '2026-06-01T10:00:00.000Z',
  '2026-06-05T14:00:00.000Z',
  '2026-06-08T09:00:00.000Z',
];

describe('AcceptAuthorizationDto', () => {
  it('normaliza notifyPatient=true apenas quando enviado explicitamente', async () => {
    const dto = plainToInstance(AcceptAuthorizationDto, {
      dateOptions: validDateOptions,
      notifyPatient: true,
    });

    expect(dto.notifyPatient).toBe(true);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('normaliza notifyPatient=false e ausente para false', async () => {
    const explicitFalse = plainToInstance(AcceptAuthorizationDto, {
      dateOptions: validDateOptions,
      notifyPatient: false,
    });
    const omitted = plainToInstance(AcceptAuthorizationDto, {
      dateOptions: validDateOptions,
    });
    const stringFalse = plainToInstance(AcceptAuthorizationDto, {
      dateOptions: validDateOptions,
      notifyPatient: 'false',
    });

    expect(explicitFalse.notifyPatient).toBe(false);
    expect(omitted.notifyPatient).toBeUndefined();
    expect(stringFalse.notifyPatient).toBe(false);
  });

  it('não aceita notifyPatient como string "true" inválida após transform', async () => {
    const dto = plainToInstance(AcceptAuthorizationDto, {
      dateOptions: validDateOptions,
      notifyPatient: 'true',
    });

    expect(dto.notifyPatient).toBe(true);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('aceita transição sem datas (opcionais, definidas depois em Agendamento)', async () => {
    const omitted = plainToInstance(AcceptAuthorizationDto, {});
    const empty = plainToInstance(AcceptAuthorizationDto, { dateOptions: [] });

    expect(await validate(omitted)).toHaveLength(0);
    expect(await validate(empty)).toHaveLength(0);
  });

  it('rejeita mais de 3 datas ou datas sem horário explícito', async () => {
    const tooMany = plainToInstance(AcceptAuthorizationDto, {
      dateOptions: [...validDateOptions, '2026-06-10T08:00:00.000Z'],
    });
    const midnight = plainToInstance(AcceptAuthorizationDto, {
      dateOptions: ['2026-06-01T00:00:00.000Z'],
    });

    expect(await validate(tooMany)).not.toHaveLength(0);
    expect(await validate(midnight)).not.toHaveLength(0);
  });
});
