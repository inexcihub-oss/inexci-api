import { PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import { AvailabilityController } from './availability.controller';

const permissoes = (metodo?: keyof AvailabilityController) =>
  Reflect.getMetadata(
    PERMISSIONS_KEY,
    metodo ? AvailabilityController.prototype[metodo] : AvailabilityController,
  );

describe('AvailabilityController (MIG-05)', () => {
  it('rota base e leitura para Agenda, Atendimento ou Administração', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AvailabilityController)).toBe(
      'availability',
    );
    expect(permissoes()).toEqual([
      Permission.AGENDA,
      Permission.ATENDIMENTO,
      Permission.ADMINISTRACAO,
    ]);
  });

  it('bloqueio se escreve com Agenda; feriado com Administração', () => {
    for (const m of ['createBlock', 'updateBlock', 'deleteBlock'] as const) {
      expect(permissoes(m)).toEqual([Permission.AGENDA]);
    }
    for (const m of [
      'createHoliday',
      'updateHoliday',
      'deleteHoliday',
    ] as const) {
      expect(permissoes(m)).toEqual([Permission.ADMINISTRACAO]);
    }
    expect(permissoes('slots')).toEqual([
      Permission.AGENDA,
      Permission.ATENDIMENTO,
    ]);
  });

  it('grade passa as permissões efetivas para o service decidir', () => {
    const schedules = {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    const controller = new AvailabilityController(
      {} as never,
      schedules as never,
      {} as never,
      {} as never,
    );
    const user = {
      userId: 'u',
      permissions: [Permission.ADMINISTRACAO],
    } as never;
    controller.createSchedule(
      { weekday: 1, startTime: '08:00', endTime: '12:00' },
      user,
    );
    expect(schedules.create).toHaveBeenCalledWith(
      { weekday: 1, startTime: '08:00', endTime: '12:00' },
      'u',
      [Permission.ADMINISTRACAO],
    );
  });
});
