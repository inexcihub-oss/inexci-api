import { PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AvailabilityController } from './availability.controller';
import { UpdateDoctorScheduleDto } from './dto/doctor-schedule.dto';
import { UpdateHolidayDto } from './dto/holiday.dto';
import { UpdateScheduleBlockDto } from './dto/schedule-block.dto';

async function invalidos(
  cls: new () => object,
  body: object,
): Promise<string[]> {
  const erros = await validate(plainToInstance(cls, body));
  return erros.map((e) => e.property).sort();
}

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
    void controller.createSchedule(
      { weekday: 1, startTime: '08:00', endTime: '12:00' },
      user,
    );
    expect(schedules.create).toHaveBeenCalledWith(
      { weekday: 1, startTime: '08:00', endTime: '12:00' },
      'u',
      [Permission.ADMINISTRACAO],
    );
  });

  it('bloqueio passa as permissões efetivas para o service decidir', () => {
    const blocks = { create: jest.fn(), update: jest.fn(), delete: jest.fn() };
    const controller = new AvailabilityController(
      {} as never,
      {} as never,
      blocks as never,
      {} as never,
    );
    const user = { userId: 'u', permissions: [Permission.AGENDA] } as never;
    const dto = {
      doctorId: null,
      startsAt: '2026-10-05T17:00:00Z',
      endsAt: '2026-10-05T18:00:00Z',
    };
    void controller.createBlock(dto, user);
    void controller.updateBlock('b1', { reason: 'x' }, user);
    void controller.deleteBlock('b1', user);
    expect(blocks.create).toHaveBeenCalledWith(dto, 'u', [Permission.AGENDA]);
    expect(blocks.update).toHaveBeenCalledWith('b1', { reason: 'x' }, 'u', [
      Permission.AGENDA,
    ]);
    expect(blocks.delete).toHaveBeenCalledWith('b1', 'u', [Permission.AGENDA]);
  });

  it('ler a grade passa as permissões efetivas para o service', () => {
    const schedules = { findByDoctor: jest.fn() };
    const controller = new AvailabilityController(
      {} as never,
      schedules as never,
      {} as never,
      {} as never,
    );
    void controller.schedules('doc-1', {
      userId: 'u',
      permissions: [Permission.ADMINISTRACAO],
    } as never);
    expect(schedules.findByDoctor).toHaveBeenCalledWith('doc-1', 'u', [
      Permission.ADMINISTRACAO,
    ]);
  });

  describe('PATCH com null explícito', () => {
    it('grade: campo obrigatório nulo é recusado; anuláveis passam', async () => {
      await expect(
        invalidos(UpdateDoctorScheduleDto, {
          weekday: null,
          startTime: null,
          endTime: null,
          slotMinutes: null,
          active: null,
        }),
      ).resolves.toEqual([
        'active',
        'endTime',
        'slotMinutes',
        'startTime',
        'weekday',
      ]);
      await expect(
        invalidos(UpdateDoctorScheduleDto, {
          clinicId: null,
          roomId: null,
          maxWalkIns: null,
          validFrom: null,
          validTo: null,
        }),
      ).resolves.toEqual([]);
      await expect(invalidos(UpdateDoctorScheduleDto, {})).resolves.toEqual([]);
    });

    it('feriado: nenhum campo aceita nulo', async () => {
      await expect(
        invalidos(UpdateHolidayDto, {
          name: null,
          date: null,
          recurring: null,
          blocksAgenda: null,
        }),
      ).resolves.toEqual(['blocksAgenda', 'date', 'name', 'recurring']);
      await expect(
        invalidos(UpdateHolidayDto, { name: 'Natal' }),
      ).resolves.toEqual([]);
    });

    it('bloqueio: início/fim/dia inteiro nulos recusados; médico/clínica/motivo anuláveis', async () => {
      await expect(
        invalidos(UpdateScheduleBlockDto, {
          startsAt: null,
          endsAt: null,
          allDay: null,
        }),
      ).resolves.toEqual(['allDay', 'endsAt', 'startsAt']);
      await expect(
        invalidos(UpdateScheduleBlockDto, {
          doctorId: null,
          clinicId: null,
          reason: null,
        }),
      ).resolves.toEqual([]);
    });
  });
});
