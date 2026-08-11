import { PatientRepository } from './patient.repository';

/**
 * A listagem de pacientes alimenta a tela `/pacientes` (nome, CPF, e-mail,
 * telefone, nascimento) e os seletores do wizard/agenda (nome e CPF). Nenhum
 * deles lê endereço, convênio ou `medicalNotes` — e `Patient` não tem
 * `@Exclude` em campo nenhum, então sem `select` a entidade inteira vai para o
 * navegador. `medicalNotes` é dado clínico: não sai numa listagem.
 */
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

  /** Colunas efetivamente pedidas ao Postgres. */
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
        'p.id',
        'p.name',
        'p.phone',
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
