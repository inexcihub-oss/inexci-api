import { ClinicalRecordRepository } from './clinical-record.repository';

describe('ClinicalRecordRepository.findPendingSurgicalIndications', () => {
  it('só traz fichas de quem pode indicar cirurgia (CRM com número e UF)', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      }),
    };
    const repo = new ClinicalRecordRepository(dataSource as never);

    await repo.findPendingSurgicalIndications(50);

    const filtro = qb.andWhere.mock.calls.find(([sql]: [string]) =>
      sql.includes('doctor_profiles'),
    );
    expect(filtro).toBeDefined();
    expect(filtro![0]).toContain('dp.crm');
    expect(filtro![0]).toContain('dp.crm_state');
    expect(filtro![1]).toEqual({ crm: 'CRM' });
    expect(qb.take).toHaveBeenCalledWith(50);
  });
});
