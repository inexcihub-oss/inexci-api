import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateAppointmentDto } from './update-appointment.dto';
import { AppointmentType } from 'src/database/entities/appointment.entity';

describe('UpdateAppointmentDto', () => {
  function erros(payload: Record<string, unknown>) {
    return validateSync(plainToInstance(UpdateAppointmentDto, payload)).map(
      (e) => e.property,
    );
  }

  it('aceita corpo vazio (nada informado)', () => {
    expect(erros({})).toEqual([]);
  });

  it('aceita notes null (apaga a observação)', () => {
    expect(erros({ notes: null })).toEqual([]);
  });

  it.each(['type', 'isWalkIn', 'scheduledAt', 'durationMinutes'])(
    'recusa %s null (coluna NOT NULL)',
    (campo) => {
      expect(erros({ [campo]: null })).toContain(campo);
    },
  );

  it('aceita os campos obrigatórios quando informados', () => {
    expect(
      erros({
        type: Object.values(AppointmentType)[0],
        isWalkIn: true,
        scheduledAt: '2026-10-10T10:00:00.000Z',
        durationMinutes: 30,
      }),
    ).toEqual([]);
  });

  it('continua aceitando null nos vínculos opcionais', () => {
    expect(erros({ clinicId: null, roomId: null, healthPlanId: null })).toEqual(
      [],
    );
  });
});
