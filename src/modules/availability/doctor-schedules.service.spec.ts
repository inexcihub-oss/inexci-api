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
    comTravaDoProfissional: jest.fn(),
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
    // A transação travada entrega as mesmas operações do repositório.
    repo.comTravaDoProfissional.mockImplementation(
      (_doctorId: string, fn: (tx: unknown) => unknown) => fn(repo),
    );
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
    await expect(
      service.findByDoctor('doc-1', 'u', [Permission.AGENDA]),
    ).rejects.toThrow(ForbiddenException);
  });

  it('Administração lê a grade de profissional da conta fora do seu vínculo', async () => {
    access.canAccessDoctor.mockResolvedValue(false);
    repo.findByDoctor.mockResolvedValue([{ id: 'g1' }]);
    await expect(
      service.findByDoctor('doc-1', 'admin', [Permission.ADMINISTRACAO]),
    ).resolves.toEqual([{ id: 'g1' }]);
    expect(repo.findByDoctor).toHaveBeenCalledWith(OWNER, 'doc-1');

    // Profissional de outra conta continua 403, mesmo com Administração.
    users.findOneWithProfile.mockResolvedValue({
      id: 'x',
      ownerId: 'outra',
      doctorProfile: {},
    });
    await expect(
      service.findByDoctor('x', 'admin', [Permission.ADMINISTRACAO]),
    ).rejects.toThrow(ForbiddenException);
  });

  describe('clínica/sala removida ou desativada', () => {
    const atual = {
      id: 'g1',
      ownerId: OWNER,
      doctorId: 'doc-1',
      clinicId: 'c1',
      roomId: 'r1',
      weekday: 1,
      startTime: '08:00:00',
      endTime: '12:00:00',
      slotMinutes: 30,
      validFrom: null,
      validTo: null,
      active: true,
    };

    beforeEach(() => {
      repo.findOne.mockResolvedValue(atual);
      // Clínica e sala soft-deletadas: não aparecem mais.
      clinics.findOne.mockResolvedValue(null);
      rooms.findOne.mockResolvedValue(null);
    });

    it('período ainda pode ser desativado e ter o horário editado', async () => {
      await expect(
        service.update('g1', { active: false }, 'doc-1', []),
      ).resolves.toMatchObject({ active: false });
      await expect(
        service.update('g1', { endTime: '11:00' }, 'doc-1', []),
      ).resolves.toMatchObject({ endTime: '11:00:00' });
      expect(clinics.findOne).not.toHaveBeenCalled();
    });

    it('trocar a clínica ou reativar o período reconfere o local', async () => {
      await expect(
        service.update('g1', { clinicId: 'c1' }, 'doc-1', []),
      ).rejects.toThrow('Clínica não encontrada.');
      repo.findOne.mockResolvedValue({ ...atual, active: false });
      await expect(
        service.update('g1', { active: true }, 'doc-1', []),
      ).rejects.toThrow('Clínica não encontrada.');
    });

    it('sala desativada não pode ser vinculada', async () => {
      clinics.findOne.mockResolvedValue({ id: 'c1', ownerId: OWNER });
      rooms.findOne.mockResolvedValue({
        id: 'r1',
        ownerId: OWNER,
        clinicId: 'c1',
        active: false,
      });
      await expect(
        service.create({ ...base, clinicId: 'c1', roomId: 'r1' }, 'doc-1', []),
      ).rejects.toThrow('A sala está desativada.');
      await expect(
        service.update('g1', { roomId: 'r1' }, 'doc-1', []),
      ).rejects.toThrow('A sala está desativada.');
    });
  });

  it('valida e grava dentro da transação travada pelo profissional', async () => {
    const ordem: string[] = [];
    repo.comTravaDoProfissional.mockImplementation(
      async (doctorId: string, fn: (tx: unknown) => Promise<unknown>) => {
        ordem.push(`trava:${doctorId}`);
        const r = await fn({
          findActiveByDoctor: () => {
            ordem.push('checa');
            return Promise.resolve([]);
          },
          create: (d: object) => {
            ordem.push('grava');
            return Promise.resolve({ id: 'g9', ...d });
          },
          update: jest.fn(),
        });
        ordem.push('commit');
        return r;
      },
    );
    await service.create(base, 'doc-1', []);
    expect(ordem).toEqual(['trava:doc-1', 'checa', 'grava', 'commit']);
    expect(repo.create).not.toHaveBeenCalled();
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
