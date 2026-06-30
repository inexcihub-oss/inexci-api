import { DocumentEntityResolverService } from './document-entity-resolver.service';

const makeQb = (rows: any[]) => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue(rows),
});

describe('DocumentEntityResolverService', () => {
  let dataSource: any;
  let accessControlService: any;
  let service: DocumentEntityResolverService;

  beforeEach(() => {
    dataSource = {
      getRepository: jest.fn(),
    };
    accessControlService = {
      getOwnerId: jest.fn().mockResolvedValue('owner-1'),
    };
    service = new DocumentEntityResolverService(
      dataSource,
      accessControlService,
    );
  });

  it('faz match exato por CPF quando disponível', async () => {
    const patientQb = makeQb([
      { id: 'p-1', name: 'Joao da Silva', cpf: '12345678901' },
    ]);
    dataSource.getRepository.mockReturnValue({
      createQueryBuilder: () => patientQb,
    });

    const result = await service.resolveCandidates(
      { patient: { name: 'Joao da Silva', cpf: '123.456.789-01' } },
      'user-1',
    );

    expect(result.patientMatchedByCpf).toBe(true);
    expect(result.patient).toHaveLength(1);
    expect(result.patient[0].id).toBe('p-1');
  });

  it('faz fallback por nome quando CPF não vem no documento', async () => {
    const patientQb = makeQb([{ id: 'p-2', name: 'Maria Souza', cpf: null }]);
    dataSource.getRepository.mockReturnValue({
      createQueryBuilder: () => patientQb,
    });

    const result = await service.resolveCandidates(
      { patient: { name: 'Maria Souza' } },
      'user-1',
    );

    expect(result.patientMatchedByCpf).toBe(false);
    expect(result.patient).toHaveLength(1);
    expect(result.patient[0].name).toBe('Maria Souza');
  });

  it('marca patientCpfMissing=true quando nome existe, CPF ausente e nenhum candidato encontrado', async () => {
    const emptyQb = makeQb([]);
    dataSource.getRepository.mockReturnValue({
      createQueryBuilder: () => emptyQb,
    });

    const result = await service.resolveCandidates(
      { patient: { name: 'Desconhecido X' } },
      'user-1',
    );

    expect(result.patientCpfMissing).toBe(true);
    expect(result.patient).toHaveLength(0);
  });

  it('retorna listas vazias quando extracted não tem campos', async () => {
    const emptyQb = makeQb([]);
    dataSource.getRepository.mockReturnValue({
      createQueryBuilder: () => emptyQb,
    });

    const result = await service.resolveCandidates({}, 'user-1');

    expect(result.patient).toHaveLength(0);
    expect(result.hospital).toHaveLength(0);
    expect(result.healthPlan).toHaveLength(0);
    expect(result.procedure).toHaveLength(0);
    expect(result.patientCpfMissing).toBe(false);
    expect(result.patientMatchedByCpf).toBe(false);
  });

  it('resolve hospital, convênio e procedimento em paralelo', async () => {
    // Patient query: CPF match
    const patientQb = makeQb([{ id: 'p-1', name: 'Joao', cpf: '12345678901' }]);
    // Hospital, healthPlan, procedure queries
    const hospitalQb = makeQb([{ id: 'h-1', name: 'Hospital X' }]);
    const healthPlanQb = makeQb([{ id: 'hp-1', name: 'Bradesco' }]);
    const procedureQb = makeQb([{ id: 'pr-1', name: 'Artrodese' }]);

    let callCount = 0;
    dataSource.getRepository.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return { createQueryBuilder: () => patientQb };
      if (callCount === 2) return { createQueryBuilder: () => hospitalQb };
      if (callCount === 3) return { createQueryBuilder: () => healthPlanQb };
      return { createQueryBuilder: () => procedureQb };
    });

    const result = await service.resolveCandidates(
      {
        patient: { name: 'Joao', cpf: '123.456.789-01' },
        hospital: 'Hospital X',
        healthPlan: { name: 'Bradesco' },
        suggestedProcedureName: 'Artrodese',
      },
      'user-1',
    );

    expect(result.patient[0].id).toBe('p-1');
    expect(result.hospital[0].id).toBe('h-1');
    expect(result.healthPlan[0].id).toBe('hp-1');
    expect(result.procedure[0].id).toBe('pr-1');
  });

  it('ignora nome com menos de 2 caracteres na busca por nome', async () => {
    // CPF é inválido (não tem 11 dígitos), nome tem 1 char
    const patientQb = makeQb([]);
    dataSource.getRepository.mockReturnValue({
      createQueryBuilder: () => patientQb,
    });

    const result = await service.resolveCandidates(
      { patient: { name: 'X' } },
      'user-1',
    );

    expect(patientQb.getMany).not.toHaveBeenCalled();
    expect(result.patient).toHaveLength(0);
  });

  it('resolve CPF com máscara para dígitos puros', async () => {
    const patientQb = makeQb([
      { id: 'p-3', name: 'Carlos', cpf: '98765432100' },
    ]);
    dataSource.getRepository.mockReturnValue({
      createQueryBuilder: () => patientQb,
    });

    const result = await service.resolveCandidates(
      { patient: { name: 'Carlos', cpf: '987.654.321-00' } },
      'user-1',
    );

    // andWhere deve ser chamado com { cpf: '98765432100' } (sem máscara)
    expect(patientQb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('cpf'),
      expect.objectContaining({ cpf: '98765432100' }),
    );
    expect(result.patientMatchedByCpf).toBe(true);
  });

  it('normaliza busca de convênio quando nome vem junto com número da carteirinha', async () => {
    const patientQb = makeQb([]);
    const hospitalQb = makeQb([]);
    const healthPlanQb = makeQb([{ id: 'hp-1', name: 'SULAMERICA' }]);
    const procedureQb = makeQb([]);

    dataSource.getRepository.mockImplementation((entity: any) => {
      if (entity?.name === 'Patient')
        return { createQueryBuilder: () => patientQb };
      if (entity?.name === 'Hospital')
        return { createQueryBuilder: () => hospitalQb };
      if (entity?.name === 'HealthPlan')
        return { createQueryBuilder: () => healthPlanQb };
      return { createQueryBuilder: () => procedureQb };
    });

    const result = await service.resolveCandidates(
      {
        healthPlan: { name: 'SULAMERICA 88888 0167 4659 0018' },
      },
      'user-1',
    );

    expect(healthPlanQb.andWhere).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        termNorm: expect.stringContaining('sulamerica'),
      }),
    );
    expect(result.healthPlan).toHaveLength(1);
    expect(result.healthPlan[0].name).toBe('SULAMERICA');
  });

  it('normaliza busca de hospital quando extração vem em frase longa', async () => {
    const patientQb = makeQb([]);
    const hospitalQb = makeQb([{ id: 'h-1', name: "Hospital Caxias D'Or" }]);
    const healthPlanQb = makeQb([]);
    const procedureQb = makeQb([]);

    dataSource.getRepository.mockImplementation((entity: any) => {
      if (entity?.name === 'Patient')
        return { createQueryBuilder: () => patientQb };
      if (entity?.name === 'Hospital')
        return { createQueryBuilder: () => hospitalQb };
      if (entity?.name === 'HealthPlan')
        return { createQueryBuilder: () => healthPlanQb };
      return { createQueryBuilder: () => procedureQb };
    });

    const result = await service.resolveCandidates(
      {
        hospital:
          'Local: Será realizada no Hospital Caxias D’or, na data de 14 de outubro de 2023.',
      },
      'user-1',
    );

    expect(hospitalQb.andWhere).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        termNorm: expect.stringContaining('hospital caxias d or'),
      }),
    );
    expect(result.hospital).toHaveLength(1);
    expect(result.hospital[0].name).toBe("Hospital Caxias D'Or");
  });
});
