import { SurgeryRequestRepository } from './surgery-request.repository';

describe('SurgeryRequestRepository — agrupamento do dashboard', () => {
  const qb = {
    leftJoin: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    addGroupBy: jest.fn(),
    orderBy: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
  const repo = new SurgeryRequestRepository(
    { createQueryBuilder: () => qb } as any,
    {} as any,
  );

  const chamadas = (fn: jest.Mock) =>
    fn.mock.calls.map(([expressao]) => String(expressao)).join('\n');

  beforeEach(() => {
    jest.clearAllMocks();
    for (const fn of Object.values(qb)) {
      if (fn !== qb.getRawMany) fn.mockReturnValue(qb);
    }
  });

  it('conta por dia no fuso de Brasília, não em UTC', async () => {
    await repo.getTemporalEvolution({}, new Date(), new Date());

    expect(qb.select).toHaveBeenCalledWith(
      "((surgeryRequest.createdAt AT TIME ZONE 'America/Sao_Paulo'))::date",
      'date',
    );
    expect(chamadas(qb.groupBy)).toContain("AT TIME ZONE 'America/Sao_Paulo'");
    expect(chamadas(qb.select)).not.toMatch(
      /DATE\(surgeryRequest\.createdAt\)/,
    );
  });

  it('conta por mês no fuso de Brasília', async () => {
    await repo.getMonthlyEvolution({}, 6);

    expect(chamadas(qb.select)).toContain(
      "TO_CHAR((surgeryRequest.createdAt AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM')",
    );
    expect(chamadas(qb.addSelect)).toContain(
      "AT TIME ZONE 'America/Sao_Paulo'",
    );
    expect(chamadas(qb.groupBy)).toContain("AT TIME ZONE 'America/Sao_Paulo'");
  });
});
