import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Permission } from 'src/shared/permissions';
import { ScheduleBlocksService } from './schedule-blocks.service';

const OWNER = 'owner-1';
const COLAB = [Permission.AGENDA];
const ADMIN = [
  Permission.AGENDA,
  Permission.ATENDIMENTO,
  Permission.SOLICITACOES,
  Permission.ADMINISTRACAO,
];

describe('ScheduleBlocksService (MIG-05)', () => {
  const repo = {
    findInRange: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    findOne: jest.fn(),
  };
  const clinics = { findOne: jest.fn() };
  const access = {
    getOwnerId: jest.fn(),
    getAccessibleDoctorIds: jest.fn(),
    canAccessDoctor: jest.fn(),
    assertSameOwner: jest.fn(),
  };
  const service = new ScheduleBlocksService(
    repo as never,
    clinics as never,
    access as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    access.getOwnerId.mockResolvedValue(OWNER);
    access.getAccessibleDoctorIds.mockResolvedValue(['doc-1', 'doc-2']);
    access.canAccessDoctor.mockImplementation(
      async (_u: string, d: string) => d !== 'doc-x',
    );
    access.assertSameOwner.mockResolvedValue(undefined);
    repo.create.mockImplementation((d: object) =>
      Promise.resolve({ id: 'b1', ...d }),
    );
  });

  const bloqueio = {
    doctorId: 'doc-1',
    startsAt: '2026-10-05T17:00:00.000Z',
    endsAt: '2026-10-05T21:00:00.000Z',
    reason: '  Congresso  ',
  };

  it('cria o bloqueio com autor e motivo aparado', async () => {
    const b = await service.create(bloqueio, 'sec-1', COLAB);
    expect(b).toMatchObject({
      ownerId: OWNER,
      doctorId: 'doc-1',
      clinicId: null,
      allDay: false,
      reason: 'Congresso',
      createdById: 'sec-1',
    });
  });

  it('bloqueio da clínica toda: admin cria sem precisar de acesso a profissional', async () => {
    await expect(
      service.create({ ...bloqueio, doctorId: null }, 'adm-1', ADMIN),
    ).resolves.toMatchObject({ doctorId: null });
    expect(access.canAccessDoctor).not.toHaveBeenCalled();
  });

  it('fim antes do início, profissional inacessível e clínica de outra conta são recusados', async () => {
    await expect(
      service.create(
        { ...bloqueio, endsAt: bloqueio.startsAt },
        'sec-1',
        COLAB,
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create({ ...bloqueio, doctorId: 'doc-x' }, 'sec-1', COLAB),
    ).rejects.toThrow(ForbiddenException);
    clinics.findOne.mockResolvedValue({ id: 'c1', ownerId: 'outra' });
    await expect(
      service.create({ ...bloqueio, clinicId: 'c1' }, 'sec-1', COLAB),
    ).rejects.toThrow('Clínica não encontrada.');
  });

  it('lista só profissionais acessíveis (e a clínica toda), com janela limitada', async () => {
    await service.findInRange(
      { from: '2026-10-01', to: '2026-10-31' },
      'sec-1',
    );
    expect(repo.findInRange).toHaveBeenCalledWith(
      OWNER,
      new Date('2026-10-01'),
      new Date('2026-10-31'),
      ['doc-1', 'doc-2'],
    );
    await expect(
      service.findInRange(
        { doctorId: 'doc-9', from: '2026-10-01', to: '2026-10-31' },
        'sec-1',
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.findInRange({ from: '2026-01-01', to: '2026-12-31' }, 'sec-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('editar e remover conferem conta e profissional', async () => {
    repo.findOne.mockResolvedValue({
      id: 'b1',
      ownerId: OWNER,
      doctorId: 'doc-x',
      startsAt: new Date(),
      endsAt: new Date(),
    });
    await expect(service.delete('b1', 'sec-1', COLAB)).rejects.toThrow(
      ForbiddenException,
    );

    repo.findOne.mockResolvedValue({
      id: 'b1',
      ownerId: OWNER,
      doctorId: 'doc-1',
      clinicId: null,
      startsAt: new Date('2026-10-05T17:00:00Z'),
      endsAt: new Date('2026-10-05T18:00:00Z'),
    });
    repo.update.mockImplementation((id: string, d: object) =>
      Promise.resolve({ id, ...d }),
    );
    await expect(
      service.update('b1', { endsAt: '2026-10-05T16:00:00Z' }, 'sec-1', COLAB),
    ).rejects.toThrow(BadRequestException);
    await service.delete('b1', 'sec-1', COLAB);
    expect(repo.softDelete).toHaveBeenCalledWith('b1');
  });

  describe('bloqueio de toda a clínica exige Administração', () => {
    const blocoClinica = {
      id: 'bc',
      ownerId: OWNER,
      doctorId: null,
      clinicId: null,
      startsAt: new Date('2026-10-05T17:00:00Z'),
      endsAt: new Date('2026-10-05T18:00:00Z'),
    };
    const blocoMedico = { ...blocoClinica, id: 'bm', doctorId: 'doc-1' };

    beforeEach(() => {
      repo.update.mockImplementation((id: string, d: object) =>
        Promise.resolve({ id, ...d }),
      );
    });

    it('colaborador sem Administração recebe 403 ao criar', async () => {
      await expect(
        service.create({ ...bloqueio, doctorId: null }, 'sec-1', COLAB),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.create({ ...bloqueio, doctorId: undefined }, 'sec-1', COLAB),
      ).rejects.toThrow('Apenas administradores da conta');
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('colaborador sem Administração recebe 403 ao editar ou remover', async () => {
      repo.findOne.mockResolvedValue(blocoClinica);
      await expect(
        service.update('bc', { reason: 'x' }, 'sec-1', COLAB),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.delete('bc', 'sec-1', COLAB)).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('colaborador sem Administração não transforma bloqueio de médico em clínica inteira', async () => {
      repo.findOne.mockResolvedValue(blocoMedico);
      await expect(
        service.update('bm', { doctorId: null }, 'sec-1', COLAB),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('admin cria, edita, converte e remove bloqueio da clínica', async () => {
      await expect(
        service.create({ ...bloqueio, doctorId: null }, 'adm-1', ADMIN),
      ).resolves.toMatchObject({ doctorId: null });

      repo.findOne.mockResolvedValue(blocoClinica);
      await expect(
        service.update('bc', { reason: 'Reforma' }, 'adm-1', ADMIN),
      ).resolves.toMatchObject({ reason: 'Reforma' });
      await service.delete('bc', 'adm-1', ADMIN);
      expect(repo.softDelete).toHaveBeenCalledWith('bc');

      repo.findOne.mockResolvedValue(blocoMedico);
      await expect(
        service.update('bm', { doctorId: null }, 'adm-1', ADMIN),
      ).resolves.toMatchObject({ doctorId: null });
    });

    it('colaborador com acesso ao médico bloqueia, edita e remove a agenda dele', async () => {
      await expect(
        service.create(bloqueio, 'sec-1', COLAB),
      ).resolves.toMatchObject({ doctorId: 'doc-1' });

      repo.findOne.mockResolvedValue(blocoMedico);
      await expect(
        service.update('bm', { reason: 'Congresso' }, 'sec-1', COLAB),
      ).resolves.toMatchObject({ reason: 'Congresso' });
      await service.delete('bm', 'sec-1', COLAB);
      expect(repo.softDelete).toHaveBeenCalledWith('bm');
    });

    it('sem acesso ao médico: 403 ao criar, editar, remover ou mover para ele', async () => {
      await expect(
        service.create({ ...bloqueio, doctorId: 'doc-x' }, 'sec-1', COLAB),
      ).rejects.toThrow(ForbiddenException);

      repo.findOne.mockResolvedValue({ ...blocoMedico, doctorId: 'doc-x' });
      await expect(
        service.update('bm', { reason: 'x' }, 'sec-1', COLAB),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.delete('bm', 'sec-1', COLAB)).rejects.toThrow(
        ForbiddenException,
      );

      repo.findOne.mockResolvedValue(blocoMedico);
      await expect(
        service.update('bm', { doctorId: 'doc-x' }, 'sec-1', COLAB),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.create({ ...bloqueio, doctorId: 'doc-x' }, 'adm-1', ADMIN),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });
});
