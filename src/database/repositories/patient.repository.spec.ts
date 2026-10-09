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
