import { SurgeryRequestsService } from './surgery-requests.service';

/**
 * Cobertura do endpoint enxuto do kanban (item 3.4): payload reduzido +
 * contadores de pendência já embutidos (sem o round-trip a batch-summary).
 */
describe('SurgeryRequestsService.findAllForKanban', () => {
  const buildRecord = (over: Record<string, unknown> = {}) => ({
    id: 'sr-1',
    status: 1,
    protocol: 'SC-000001',
    priority: 2,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    lastStatusChangedAt: new Date('2026-01-02'),
    surgeryDate: null,
    isIndication: false,
    indicationName: null,
    patient: { id: 'p-1', name: 'Paciente', cpf: '123' },
    doctor: { id: 'd-1', name: 'Médico' },
    healthPlan: { id: 'hp-1', name: 'Convênio' },
    procedure: { id: 'proc-1', name: 'Artroscopia' },
    pendenciesCount: 4,
    completedCount: 0,
    totalPendencies: 4,
    hasIncompletePayment: false,
    ...over,
  });

  function makeService(overrides: {
    doctorIds?: string[];
    records?: unknown[];
    total?: number;
    batch?: Record<
      string,
      { pending: number; total: number; canAdvance: boolean }
    >;
  }) {
    const accessControlService = {
      getAccessibleDoctorIds: jest
        .fn()
        .mockResolvedValue(overrides.doctorIds ?? ['d-1']),
      getOwnerId: jest.fn().mockResolvedValue('owner-1'),
    };
    const surgeryRequestRepository = {
      total: jest.fn().mockResolvedValue(overrides.total ?? 1),
      findMany: jest
        .fn()
        .mockResolvedValue(overrides.records ?? [buildRecord()]),
    };
    const pendencyValidatorService = {
      getBatchSummary: jest.fn().mockResolvedValue(overrides.batch ?? {}),
    };

    const service = new SurgeryRequestsService(
      {} as never,
      accessControlService as never,
      {} as never,
      surgeryRequestRepository as never,
      {} as never,
      {} as never,
      {} as never,
      pendencyValidatorService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return {
      service,
      accessControlService,
      surgeryRequestRepository,
      pendencyValidatorService,
    };
  }

  it('retorna vazio quando o usuário não enxerga nenhum médico', async () => {
    const { service, surgeryRequestRepository } = makeService({
      doctorIds: [],
    });

    const result = await service.findAllForKanban({}, 'user-1');

    expect(result).toEqual({ total: 0, records: [] });
    expect(surgeryRequestRepository.findMany).not.toHaveBeenCalled();
  });

  it('mapeia apenas os campos do card e embute os contadores reais de pendência', async () => {
    const { service, pendencyValidatorService } = makeService({
      total: 1,
      records: [buildRecord()],
      batch: { 'sr-1': { pending: 2, total: 5, canAdvance: false } },
    });

    const result = await service.findAllForKanban({}, 'user-1');

    expect(pendencyValidatorService.getBatchSummary).toHaveBeenCalledWith(
      'sr-1',
      'owner-1',
    );
    expect(result.total).toBe(1);
    const card = result.records[0] as Record<string, unknown>;
    // Contadores vêm do validador em lote, não do cálculo simplificado.
    expect(card.pendenciesCount).toBe(2);
    expect(card.totalPendencies).toBe(5);
    expect(card.canAdvance).toBe(false);
    expect(card.patient).toEqual({ id: 'p-1', name: 'Paciente' });
    expect(card.procedure).toEqual({ id: 'proc-1', name: 'Artroscopia' });
    // Campos pesados não devem vazar no card enxuto.
    expect(card).not.toHaveProperty('documents');
    expect(card).not.toHaveProperty('completedCount');
  });

  it('faz fallback para o contador do repositório quando o lote não tem o id', async () => {
    const { service } = makeService({
      records: [buildRecord({ pendenciesCount: 3, totalPendencies: 4 })],
      batch: {},
    });

    const result = await service.findAllForKanban({}, 'user-1');
    const card = result.records[0] as Record<string, unknown>;
    expect(card.pendenciesCount).toBe(3);
    expect(card.totalPendencies).toBe(4);
    expect(card.canAdvance).toBe(true);
  });

  it('aplica filtro de status no where quando informado', async () => {
    const { service, surgeryRequestRepository } = makeService({
      records: [buildRecord()],
    });

    await service.findAllForKanban({ status: [1, 2] }, 'user-1');

    const whereArg = surgeryRequestRepository.findMany.mock.calls[0][0];
    expect(whereArg).toHaveProperty('status');
  });
});

describe('SurgeryRequestsService.findAgenda', () => {
  function makeService(records: unknown[], doctorIds: string[] = ['d-1']) {
    const accessControlService = {
      getAccessibleDoctorIds: jest.fn().mockResolvedValue(doctorIds),
    };
    const surgeryRequestRepository = {
      total: jest.fn().mockResolvedValue(records.length),
      findMany: jest.fn().mockResolvedValue(records),
    };
    const opmeItemRepository = {
      findSelectedSuppliersByRequestIds: jest.fn().mockResolvedValue([]),
    };
    const service = new SurgeryRequestsService(
      {} as never,
      accessControlService as never,
      {} as never,
      surgeryRequestRepository as never,
      {} as never,
      opmeItemRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, surgeryRequestRepository };
  }

  it('consulta por intervalo de surgeryDate e devolve cards enxutos', async () => {
    const record = {
      id: 'sr-1',
      status: 5,
      protocol: 'SC-1',
      priority: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastStatusChangedAt: null,
      surgeryDate: new Date('2026-07-15'),
      isIndication: false,
      indicationName: null,
      patient: { id: 'p-1', name: 'Paciente' },
      doctor: { id: 'd-1', name: 'Médico' },
      healthPlan: null,
      procedure: { id: 'proc-1', name: 'Cirurgia' },
      pendenciesCount: 0,
      totalPendencies: 0,
      hasIncompletePayment: false,
    };
    const { service, surgeryRequestRepository } = makeService([record]);

    const result = await service.findAgenda(
      { from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T23:59:59.999Z' },
      'user-1',
    );

    const whereArg = surgeryRequestRepository.findMany.mock.calls[0][0];
    expect(whereArg).toHaveProperty('surgeryDate');
    expect(whereArg).toHaveProperty('doctorId');
    expect(result.records).toHaveLength(1);
    expect((result.records[0] as Record<string, unknown>).surgeryDate).toEqual(
      record.surgeryDate,
    );
  });

  it('retorna vazio quando não há médicos acessíveis', async () => {
    const { service, surgeryRequestRepository } = makeService([], []);

    const result = await service.findAgenda(
      { from: '2026-07-01', to: '2026-07-31' },
      'user-1',
    );

    expect(result).toEqual({ total: 0, records: [] });
    expect(surgeryRequestRepository.findMany).not.toHaveBeenCalled();
  });
});
