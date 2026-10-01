import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Permission } from 'src/shared/permissions';
import { DoctorSchedulesService } from './doctor-schedules.service';

const OWNER = 'owner-1';

describe('DoctorSchedulesService (MIG-05)', () => {
  const repo = {
    findByDoctor: jest.fn(),
    findActiveByDoctor: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    findOne: jest.fn(),
  };
  const clinics = { findOne: jest.fn() };
  const rooms = { findOne: jest.fn() };
  const users = { findOneWithProfile: jest.fn() };
  const access = {
    canAccessDoctor: jest.fn(),
    getOwnerId: jest.fn(),
    assertSameOwner: jest.fn(),
  };
  const service = new DoctorSchedulesService(
    repo as never,
    clinics as never,
    rooms as never,
    users as never,
    access as never,
  );
  const base = { weekday: 1, startTime: '08:00', endTime: '12:00' };

  beforeEach(() => {
    jest.resetAllMocks();
    access.getOwnerId.mockResolvedValue(OWNER);
    access.canAccessDoctor.mockResolvedValue(true);
    access.assertSameOwner.mockResolvedValue(undefined);
    users.findOneWithProfile.mockResolvedValue({
      id: 'doc-1',
      ownerId: OWNER,
      doctorProfile: { id: 'p' },
    });
    repo.findActiveByDoctor.mockResolvedValue([]);
    repo.create.mockImplementation((d: object) =>
      Promise.resolve({ id: 'g1', ...d }),
    );
    repo.update.mockImplementation((id: string, d: object) =>
      Promise.resolve({ id, ...d }),
    );
  });

  it('o profissional cria a própria grade, com padrões e horário em HH:MM:SS', async () => {
    const g = await service.create(base, 'doc-1', []);
    expect(g).toMatchObject({
      ownerId: OWNER,
      doctorId: 'doc-1',
      startTime: '08:00:00',
      endTime: '12:00:00',
      slotMinutes: 30,
      active: true,
      clinicId: null,
      validFrom: null,
    });
  });

  it('grade de outro profissional exige Administração', async () => {
    await expect(
      service.create({ ...base, doctorId: 'doc-1' }, 'secretaria', [
        Permission.AGENDA,
      ]),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.create({ ...base, doctorId: 'doc-1' }, 'admin', [
        Permission.ADMINISTRACAO,
      ]),
    ).resolves.toMatchObject({ doctorId: 'doc-1' });
  });

  it('só profissional de saúde da mesma conta tem grade', async () => {
    users.findOneWithProfile.mockResolvedValue({
      id: 'sec',
      ownerId: OWNER,
      doctorProfile: null,
    });
    await expect(service.create(base, 'sec', [])).rejects.toThrow(
      BadRequestException,
    );
    users.findOneWithProfile.mockResolvedValue({
      id: 'x',
      ownerId: 'outra',
      doctorProfile: {},
    });
    await expect(
      service.create({ ...base, doctorId: 'x' }, 'admin', [
        Permission.ADMINISTRACAO,
      ]),
    ).rejects.toThrow(ForbiddenException);
  });

  it('valida horário, intervalo e vigência', async () => {
    await expect(
      service.create({ ...base, endTime: '08:00' }, 'doc-1', []),
    ).rejects.toThrow('O início deve ser antes do fim.');
    await expect(
      service.create(
        { ...base, endTime: '08:20', slotMinutes: 30 },
        'doc-1',
        [],
      ),
    ).rejects.toThrow('não comporta');
    await expect(
      service.create(
        { ...base, validFrom: '2026-02-01', validTo: '2026-01-01' },
        'doc-1',
        [],
      ),
    ).rejects.toThrow('vigência');
  });

  it('sala precisa ser da clínica da grade', async () => {
    clinics.findOne.mockResolvedValue({ id: 'c1', ownerId: OWNER });
    rooms.findOne.mockResolvedValue({
      id: 'r1',
      ownerId: OWNER,
      clinicId: 'c2',
    });
    await expect(
      service.create({ ...base, clinicId: 'c1', roomId: 'r1' }, 'doc-1', []),
    ).rejects.toThrow('A sala não pertence à clínica da grade.');
  });

  it('sobreposição no mesmo dia e vigência → 409; vigências separadas convivem', async () => {
    repo.findActiveByDoctor.mockResolvedValue([
      {
        id: 'g0',
        weekday: 1,
        startTime: '11:00:00',
        endTime: '14:00:00',
        validFrom: null,
        validTo: '2026-06-30',
      },
    ]);
    await expect(service.create(base, 'doc-1', [])).rejects.toThrow(
      ConflictException,
    );
    await expect(
      service.create({ ...base, validFrom: '2026-07-01' }, 'doc-1', []),
    ).resolves.toBeDefined();
    await expect(
      service.create({ ...base, weekday: 2 }, 'doc-1', []),
    ).resolves.toBeDefined();
  });

  it('editar ignora o próprio período na checagem de sobreposição', async () => {
    const atual = {
      id: 'g1',
      ownerId: OWNER,
      doctorId: 'doc-1',
      clinicId: null,
      roomId: null,
      weekday: 1,
      startTime: '08:00:00',
      endTime: '12:00:00',
      slotMinutes: 30,
      validFrom: null,
      validTo: null,
      active: true,
    };
    repo.findOne.mockResolvedValue(atual);
    repo.findActiveByDoctor.mockResolvedValue([atual]);
    await expect(
      service.update('g1', { endTime: '13:00' }, 'doc-1', []),
    ).resolves.toMatchObject({ endTime: '13:00:00' });
  });

  it('ler exige acesso ao profissional', async () => {
    access.canAccessDoctor.mockResolvedValue(false);
    await expect(service.findByDoctor('doc-1', 'u')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('remover é soft delete e segue a mesma regra de escrita', async () => {
    repo.findOne.mockResolvedValue({
      id: 'g1',
      ownerId: OWNER,
      doctorId: 'doc-1',
    });
    await service.delete('g1', 'doc-1', []);
    expect(repo.softDelete).toHaveBeenCalledWith('g1');
    await expect(service.delete('g1', 'outro', [])).rejects.toThrow(
      ForbiddenException,
    );
  });
});
