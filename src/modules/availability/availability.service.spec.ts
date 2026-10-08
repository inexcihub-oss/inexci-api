import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  AvailabilityService,
  bloqueioAtinge,
  feriadoDoDia,
} from './availability.service';

const OWNER = 'owner-1';
const DOC = 'doc-1';

function grade(parcial: object = {}) {
  return {
    id: 'g1',
    doctorId: DOC,
    clinicId: null,
    weekday: 1, // segunda
    startTime: '08:00:00',
    endTime: '10:00:00',
    slotMinutes: 30,
    validFrom: null,
    validTo: null,
    active: true,
    ...parcial,
  };
}

describe('AvailabilityService (MIG-05)', () => {
  const schedules = { findActiveByDoctor: jest.fn() };
  const blocks = { findInRange: jest.fn() };
  const holidays = { findByOwner: jest.fn() };
  const appointments = { findOcupando: jest.fn() };
  const access = { canAccessDoctor: jest.fn(), getOwnerId: jest.fn() };
  const service = new AvailabilityService(
    schedules as never,
    blocks as never,
    holidays as never,
    appointments as never,
    access as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    schedules.findActiveByDoctor.mockResolvedValue([grade()]);
    blocks.findInRange.mockResolvedValue([]);
    holidays.findByOwner.mockResolvedValue([]);
    appointments.findOcupando.mockResolvedValue([]);
    access.canAccessDoctor.mockResolvedValue(true);
    access.getOwnerId.mockResolvedValue(OWNER);
  });

  const segunda = '2026-10-05';
  const slots = (from = segunda, to = segunda) =>
    service.getSlots({ doctorId: DOC, from, to }, 'u-1');

  describe('getSlots', () => {
    it('recusa intervalo enorme sem expandir as datas', async () => {
      await expect(slots('0001-01-01', '9999-12-31')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(access.canAccessDoctor).not.toHaveBeenCalled();
    });

    it('recusa intervalo invertido', async () => {
      await expect(slots('2026-10-06', '2026-10-05')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('expande a grade em horários de São Paulo no dia da semana certo', async () => {
      const [dia] = await slots();
      expect(dia.slots.map((s) => s.start)).toEqual([
        '2026-10-05T11:00:00.000Z',
        '2026-10-05T11:30:00.000Z',
        '2026-10-05T12:00:00.000Z',
        '2026-10-05T12:30:00.000Z',
      ]);
      expect(dia.slots.every((s) => s.free)).toBe(true);

      const [terca] = await slots('2026-10-06', '2026-10-06');
      expect(terca.slots).toEqual([]);
    });

    it('cada horário traz a clínica/sala do período da grade que o gerou', async () => {
      schedules.findActiveByDoctor.mockResolvedValue([
        grade({ endTime: '08:30:00', clinicId: 'cli-1', roomId: 'sala-1' }),
        grade({ id: 'g2', startTime: '14:00:00', endTime: '14:30:00' }),
      ]);
      const [dia] = await slots();
      expect(dia.slots.map((s) => [s.clinicId, s.roomId])).toEqual([
        ['cli-1', 'sala-1'],
        [null, null],
      ]);
    });

    it('último horário que não cabe inteiro fica de fora', async () => {
      schedules.findActiveByDoctor.mockResolvedValue([
        grade({ endTime: '09:45:00', slotMinutes: 30 }),
      ]);
      const [dia] = await slots();
      expect(dia.slots).toHaveLength(3);
    });

    it('respeita a vigência', async () => {
      schedules.findActiveByDoctor.mockResolvedValue([
        grade({ validTo: '2026-10-04' }),
        grade({
          id: 'g2',
          startTime: '14:00:00',
          endTime: '15:00:00',
          validFrom: '2026-10-05',
        }),
      ]);
      const [dia] = await slots();
      expect(dia.slots.map((s) => s.start)).toEqual([
        '2026-10-05T17:00:00.000Z',
        '2026-10-05T17:30:00.000Z',
      ]);
    });

    it('consulta ocupa o horário; bloqueio parcial marca só o que encosta', async () => {
      appointments.findOcupando.mockResolvedValue([
        {
          scheduledAt: new Date('2026-10-05T11:00:00.000Z'),
          durationMinutes: 30,
        },
      ]);
      blocks.findInRange.mockResolvedValue([
        {
          doctorId: DOC,
          clinicId: null,
          startsAt: new Date('2026-10-05T12:15:00.000Z'),
          endsAt: new Date('2026-10-05T12:45:00.000Z'),
        },
      ]);
      const [dia] = await slots();
      expect(dia.slots.map((s) => s.reason ?? 'livre')).toEqual([
        'appointment',
        'livre',
        'block',
        'block',
      ]);
    });

    it('feriado recorrente que bloqueia a agenda ocupa o dia inteiro em qualquer ano', async () => {
      holidays.findByOwner.mockResolvedValue([
        {
          name: 'Aniversário da cidade',
          date: '2019-10-05',
          recurring: true,
          blocksAgenda: true,
        },
      ]);
      const [dia] = await slots();
      expect(dia.holiday).toEqual({
        name: 'Aniversário da cidade',
        blocksAgenda: true,
      });
      expect(dia.slots.every((s) => s.reason === 'holiday')).toBe(true);
    });

    it('feriado que não bloqueia só aparece como informação', async () => {
      holidays.findByOwner.mockResolvedValue([
        {
          name: 'Ponto facultativo',
          date: segunda,
          recurring: false,
          blocksAgenda: false,
        },
      ]);
      const [dia] = await slots();
      expect(dia.holiday?.blocksAgenda).toBe(false);
      expect(dia.slots.every((s) => s.free)).toBe(true);
    });

    it('limita a janela e o acesso ao profissional', async () => {
      await expect(slots('2026-10-01', '2026-11-15')).rejects.toThrow(
        BadRequestException,
      );
      await expect(slots('2026-10-05', '2026-10-01')).rejects.toThrow(
        BadRequestException,
      );
      access.canAccessDoctor.mockResolvedValue(false);
      await expect(slots()).rejects.toThrow(ForbiddenException);
    });
  });

  describe('assertNaoBloqueado', () => {
    const intervalo = {
      ownerId: OWNER,
      doctorId: DOC,
      clinicId: 'c1',
      start: new Date('2026-10-05T17:00:00.000Z'),
      end: new Date('2026-10-05T17:30:00.000Z'),
    };

    it('livre passa', async () => {
      await expect(
        service.assertNaoBloqueado(intervalo),
      ).resolves.toBeUndefined();
    });

    it('bloqueio do profissional ou da clínica toda → 409 com o motivo', async () => {
      blocks.findInRange.mockResolvedValue([
        { doctorId: null, clinicId: null, reason: 'Reunião geral' },
      ]);
      await expect(service.assertNaoBloqueado(intervalo)).rejects.toThrow(
        new ConflictException(
          'Horário bloqueado na agenda do profissional: Reunião geral.',
        ),
      );
    });

    it('bloqueio de outra clínica não atinge a consulta desta', async () => {
      blocks.findInRange.mockResolvedValue([
        { doctorId: null, clinicId: 'c2', reason: 'Dedetização' },
      ]);
      await expect(
        service.assertNaoBloqueado(intervalo),
      ).resolves.toBeUndefined();
    });

    it('feriado que bloqueia → 409; que não bloqueia → passa', async () => {
      holidays.findByOwner.mockResolvedValue([
        {
          name: 'Finados',
          date: '2025-10-05',
          recurring: true,
          blocksAgenda: true,
        },
      ]);
      await expect(service.assertNaoBloqueado(intervalo)).rejects.toThrow(
        'feriado (Finados)',
      );

      holidays.findByOwner.mockResolvedValue([
        {
          name: 'Facultativo',
          date: '2026-10-05',
          recurring: false,
          blocksAgenda: false,
        },
      ]);
      await expect(
        service.assertNaoBloqueado(intervalo),
      ).resolves.toBeUndefined();
    });
  });

  describe('foraDaGrade', () => {
    const em = (iso: string, minutos = 30) => {
      const start = new Date(iso);
      return service.foraDaGrade(
        DOC,
        start,
        new Date(start.getTime() + minutos * 60_000),
      );
    };

    it('sem grade configurada nada está fora', async () => {
      schedules.findActiveByDoctor.mockResolvedValue([]);
      await expect(em('2026-10-06T03:00:00.000Z')).resolves.toBe(false);
    });

    it('período com clínica só cobre consulta naquela clínica', async () => {
      schedules.findActiveByDoctor.mockResolvedValue([
        grade({ clinicId: 'c1' }),
      ]);
      const start = new Date('2026-10-05T11:00:00.000Z');
      const end = new Date('2026-10-05T11:30:00.000Z');
      await expect(service.foraDaGrade(DOC, start, end, 'c1')).resolves.toBe(
        false,
      );
      await expect(service.foraDaGrade(DOC, start, end, 'c2')).resolves.toBe(
        true,
      );
      await expect(service.foraDaGrade(DOC, start, end, null)).resolves.toBe(
        true,
      );
      // Sem informar a clínica, a clínica não é considerada.
      await expect(service.foraDaGrade(DOC, start, end)).resolves.toBe(false);
    });

    it('período sem clínica cobre consulta em qualquer clínica', async () => {
      const start = new Date('2026-10-05T11:00:00.000Z');
      const end = new Date('2026-10-05T11:30:00.000Z');
      await expect(service.foraDaGrade(DOC, start, end, 'c2')).resolves.toBe(
        false,
      );
    });

    it('dentro, atravessando o fim e em outro dia da semana', async () => {
      await expect(em('2026-10-05T11:00:00.000Z')).resolves.toBe(false); // 08:00 seg
      await expect(em('2026-10-05T12:45:00.000Z')).resolves.toBe(true); // 09:45–10:15
      await expect(em('2026-10-06T11:00:00.000Z')).resolves.toBe(true); // terça
    });
  });

  describe('bloqueioAtinge (matriz)', () => {
    const b = (doctorId: string | null, clinicId: string | null) =>
      ({ doctorId, clinicId }) as never;
    it.each([
      // [bloqueio médico, bloqueio clínica, item clínica, atinge]
      [null, null, 'c1', true],
      [null, null, null, true],
      [DOC, null, 'c1', true],
      [DOC, null, null, true],
      [null, 'c1', 'c1', true],
      [null, 'c1', 'c2', false],
      [null, 'c1', null, false],
      [DOC, 'c1', 'c1', true],
      [DOC, 'c1', 'c2', false],
      [DOC, 'c1', null, true],
      ['outro', null, 'c1', false],
      ['outro', null, null, false],
      ['outro', 'c1', 'c1', false],
    ])(
      'bloqueio (%s, %s) × item na clínica %s → %s',
      (medico, clinica, itemClinica, esperado) => {
        expect(bloqueioAtinge(b(medico, clinica), DOC, itemClinica)).toBe(
          esperado,
        );
      },
    );

    it('bloqueio só da clínica não trava horário de grade sem clínica', async () => {
      blocks.findInRange.mockResolvedValue([
        {
          doctorId: null,
          clinicId: 'c1',
          startsAt: new Date('2026-10-05T11:00:00.000Z'),
          endsAt: new Date('2026-10-05T13:00:00.000Z'),
        },
      ]);
      const [dia] = await slots();
      expect(dia.slots.every((s) => s.free)).toBe(true);
      await expect(
        service.assertNaoBloqueado({
          ownerId: OWNER,
          doctorId: DOC,
          clinicId: null,
          start: new Date('2026-10-05T11:00:00.000Z'),
          end: new Date('2026-10-05T11:30:00.000Z'),
        }),
      ).resolves.toBeUndefined();
    });
  });

  it('feriadoDoDia: data exata ou mesmo dia/mês quando recorrente', () => {
    const lista = [
      { date: '2020-12-25', recurring: true },
      { date: '2026-02-17', recurring: false },
    ] as never;
    expect(feriadoDoDia(lista, '2031-12-25')).toBeDefined();
    expect(feriadoDoDia(lista, '2027-02-17')).toBeUndefined();
    expect(feriadoDoDia(lista, '2026-02-17')).toBeDefined();
  });
});
