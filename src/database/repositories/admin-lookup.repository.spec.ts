import { In, Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { AdminLookupRepository } from './admin-lookup.repository';

describe('AdminLookupRepository', () => {
  const find = jest.fn();
  const repository = new AdminLookupRepository({
    find,
  } as unknown as Repository<User>);

  beforeEach(() => jest.resetAllMocks());

  it('não consulta o banco sem ids', async () => {
    await expect(repository.ownersOfUsers([])).resolves.toEqual(new Map());
    await expect(repository.accountNames([])).resolves.toEqual(new Map());
    expect(find).not.toHaveBeenCalled();
  });

  it('resolve o dono de cada usuário numa consulta só, sem repetir ids', async () => {
    find.mockResolvedValue([
      { id: 'u-1', ownerId: 'o-1' },
      { id: 'u-2', ownerId: null },
    ]);
    const map = await repository.ownersOfUsers(['u-1', 'u-1', 'u-2']);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: In(['u-1', 'u-2']) } }),
    );
    expect([...map]).toEqual([['u-1', 'o-1']]);
  });

  it('busca os nomes das contas', async () => {
    find.mockResolvedValue([{ id: 'o-1', name: 'Clínica Alfa' }]);
    const map = await repository.accountNames(['o-1']);
    expect(map.get('o-1')).toBe('Clínica Alfa');
  });
});
