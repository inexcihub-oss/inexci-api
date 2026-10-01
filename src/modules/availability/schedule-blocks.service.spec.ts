import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ScheduleBlocksService } from './schedule-blocks.service';

const OWNER = 'owner-1';

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
    const b = await service.create(bloqueio, 'sec-1');
    expect(b).toMatchObject({
      ownerId: OWNER,
      doctorId: 'doc-1',
      clinicId: null,
      allDay: false,
      reason: 'Congresso',
      createdById: 'sec-1',
    });
  });

  it('bloqueio da clínica toda não exige acesso a profissional', async () => {
    await expect(
      service.create({ ...bloqueio, doctorId: null }, 'sec-1'),
    ).resolves.toMatchObject({ doctorId: null });
  });

  it('fim antes do início, profissional inacessível e clínica de outra conta são recusados', async () => {
    await expect(
      service.create({ ...bloqueio, endsAt: bloqueio.startsAt }, 'sec-1'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create({ ...bloqueio, doctorId: 'doc-x' }, 'sec-1'),
    ).rejects.toThrow(ForbiddenException);
    clinics.findOne.mockResolvedValue({ id: 'c1', ownerId: 'outra' });
    await expect(
      service.create({ ...bloqueio, clinicId: 'c1' }, 'sec-1'),
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
    await expect(service.delete('b1', 'sec-1')).rejects.toThrow(
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
      service.update('b1', { endsAt: '2026-10-05T16:00:00Z' }, 'sec-1'),
    ).rejects.toThrow(BadRequestException);
    await service.delete('b1', 'sec-1');
    expect(repo.softDelete).toHaveBeenCalledWith('b1');
  });
});
