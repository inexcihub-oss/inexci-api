import { NotFoundException } from '@nestjs/common';
import { HolidaysService } from './holidays.service';

describe('HolidaysService (MIG-05)', () => {
  const repo = {
    findByOwner: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    findOne: jest.fn(),
  };
  const access = { getOwnerId: jest.fn(), assertSameOwner: jest.fn() };
  const service = new HolidaysService(repo as never, access as never);

  beforeEach(() => {
    jest.resetAllMocks();
    access.getOwnerId.mockResolvedValue('owner-1');
    repo.create.mockImplementation((d: object) =>
      Promise.resolve({ id: 'h1', ...d }),
    );
  });

  it('lista do ano inclui os recorrentes de qualquer ano', async () => {
    repo.findByOwner.mockResolvedValue([
      { date: '2020-12-25', recurring: true },
      { date: '2026-02-17', recurring: false },
      { date: '2027-02-09', recurring: false },
    ]);
    const lista = await service.findMany('u', 2026);
    expect(lista.map((h) => h.date)).toEqual(['2020-12-25', '2026-02-17']);
    expect(await service.findMany('u')).toHaveLength(3);
  });

  it('cria com padrões: não recorrente, bloqueia a agenda', async () => {
    await expect(
      service.create({ name: ' Carnaval ', date: '2026-02-17T00:00:00Z' }, 'u'),
    ).resolves.toMatchObject({
      ownerId: 'owner-1',
      name: 'Carnaval',
      date: '2026-02-17',
      recurring: false,
      blocksAgenda: true,
    });
  });

  it('alterar/remover confere a conta; inexistente → 404', async () => {
    repo.findOne.mockResolvedValue({ id: 'h1', ownerId: 'owner-1' });
    repo.update.mockImplementation((id: string, d: object) =>
      Promise.resolve({ id, ...d }),
    );
    await expect(
      service.update('h1', { blocksAgenda: false }, 'u'),
    ).resolves.toMatchObject({
      blocksAgenda: false,
    });
    expect(access.assertSameOwner).toHaveBeenCalledWith('u', 'owner-1');
    await service.delete('h1', 'u');
    expect(repo.softDelete).toHaveBeenCalledWith('h1');

    repo.findOne.mockResolvedValue(null);
    await expect(service.delete('x', 'u')).rejects.toThrow(NotFoundException);
  });
});
