import { PatientRepository } from './patient.repository';

describe('PatientRepository.findAndCountWithSearch', () => {
  function buildRepo() {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      }),
    };
    return { repo: new PatientRepository(dataSource as never), qb };
  }

  const colunas = (qb: { select: jest.Mock }) =>
    (qb.select.mock.calls[0]?.[0] as string[]) ?? [];

  it('pede só as colunas que a listagem e os seletores exibem', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAndCountWithSearch('owner-1', undefined, 0, 10);

    expect(colunas(qb).sort()).toEqual(
      [
        'p.birthDate',
        'p.cpf',
        'p.createdAt',
        'p.email',
        'p.healthPlanId',
        'p.id',
        'p.name',
        'p.phone',
        'p.photoPath',
        'p.updatedAt',
      ].sort(),
    );
  });

  it('não expõe dado clínico nem endereço na listagem', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAndCountWithSearch('owner-1', undefined, 0, 10);

    for (const proibida of [
      'p.medicalNotes',
      'p.address',
      'p.zipCode',
      'p.healthPlanNumber',
      'p.gender',
    ]) {
      expect(colunas(qb)).not.toContain(proibida);
    }
  });

  it('mantém o escopo por clínica e a busca por nome, e-mail ou CPF', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAndCountWithSearch('owner-1', ' maria ', 0, 10);

    expect(qb.where).toHaveBeenCalledWith('p.owner_id = :ownerId', {
      ownerId: 'owner-1',
    });
    expect(qb.andWhere).toHaveBeenCalledWith(expect.any(String), {
      term: '%maria%',
    });
  });
});

describe('PatientRepository — escape de curingas do LIKE', () => {
  function buildRepo() {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      }),
    };
    return { repo: new PatientRepository(dataSource as never), qb };
  }

  it('escapa % e _ na busca da listagem', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAndCountWithSearch('owner-1', '50%_a', 0, 10);

    expect(qb.andWhere).toHaveBeenCalledWith(expect.any(String), {
      term: '%50\\%\\_a%',
    });
  });

  it('escapa curingas nos modos contains e prefix', async () => {
    const { repo, qb } = buildRepo();

    await repo.findByNameIlike('owner-1', 'a%', 'contains', 5);
    await repo.findByNameIlike('owner-1', 'b_', 'prefix', 5);

    expect(qb.andWhere).toHaveBeenNthCalledWith(1, expect.any(String), {
      term: '%a\\%%',
    });
    expect(qb.andWhere).toHaveBeenNthCalledWith(2, expect.any(String), {
      term: 'b\\_%',
    });
  });

  it('modo exact compara por igualdade, sem escape', async () => {
    const { repo, qb } = buildRepo();

    await repo.findByNameIlike('owner-1', 'a%', 'exact', 5);

    expect(qb.andWhere).toHaveBeenCalledWith(
      'unaccent(lower(p.name)) = unaccent(lower(:term))',
      { term: 'a%' },
    );
  });
});

describe('PatientRepository.create', () => {
  it('grava pelo manager da transação quando informado', async () => {
    const padrao = { create: jest.fn(), save: jest.fn() };
    const txRepo = {
      create: jest.fn((d) => d),
      save: jest.fn((d) => Promise.resolve({ id: 'p-1', ...d })),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(txRepo) };
    const repo = new PatientRepository({
      getRepository: () => padrao,
    } as never);

    const criado = await repo.create({ name: 'Maria' }, manager as never);

    expect(criado).toEqual({ id: 'p-1', name: 'Maria' });
    expect(txRepo.save).toHaveBeenCalled();
    expect(padrao.save).not.toHaveBeenCalled();
  });

  it('usa o repositório padrão sem manager', async () => {
    const padrao = {
      create: jest.fn((d) => d),
      save: jest.fn((d) => Promise.resolve(d)),
    };
    const repo = new PatientRepository({
      getRepository: () => padrao,
    } as never);

    await repo.create({ name: 'Maria' });

    expect(padrao.save).toHaveBeenCalled();
  });
});
