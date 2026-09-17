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
    supplierRows?: Array<{
      surgeryRequestId: string;
      supplierId: string;
      supplierName: string;
    }>;
    clinicRows?: Array<{
      surgeryRequestId: string;
      clinicId: string;
      clinicName: string;
    }>;
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
    const opmeItemRepository = {
      findSelectedSuppliersByRequestIds: jest
        .fn()
        .mockResolvedValue(overrides.supplierRows ?? []),
    };
    const clinicalRecordRepository = {
      findClinicsBySurgeryRequestIds: jest
        .fn()
        .mockResolvedValue(overrides.clinicRows ?? []),
    };

    const service = new SurgeryRequestsService(
      {} as never,
      accessControlService as never,
      {} as never,
      surgeryRequestRepository as never,
      {} as never,
      opmeItemRepository as never,
      {} as never,
      pendencyValidatorService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      clinicalRecordRepository as never,
    );

    return {
      service,
      accessControlService,
      surgeryRequestRepository,
      pendencyValidatorService,
      opmeItemRepository,
      clinicalRecordRepository,
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

  /**
   * O filtro de fornecedor do kanban roda no cliente, sobre os cards já
   * carregados: sem este campo no payload não há o que filtrar. Fornecedor da
   * SC é o ESCOLHIDO no OPME — mesma definição que a agenda e a tela do
   * fornecedor já usam.
   */
  it('leva os fornecedores escolhidos no OPME para o card', async () => {
    const { service, opmeItemRepository } = makeService({
      records: [buildRecord()],
      supplierRows: [
        { surgeryRequestId: 'sr-1', supplierId: 'f-1', supplierName: 'Sintex' },
        // Dois itens OPME do mesmo fornecedor não podem duplicar a opção.
        { surgeryRequestId: 'sr-1', supplierId: 'f-1', supplierName: 'Sintex' },
        { surgeryRequestId: 'sr-1', supplierId: 'f-2', supplierName: 'Baumer' },
        // Fornecedor de outra SC não pode vazar para este card.
        { surgeryRequestId: 'sr-9', supplierId: 'f-3', supplierName: 'Outro' },
      ],
    });

    const result = await service.findAllForKanban({}, 'user-1');

    expect(
      opmeItemRepository.findSelectedSuppliersByRequestIds,
    ).toHaveBeenCalledWith(['sr-1']);
    const card = result.records[0] as Record<string, unknown>;
    expect(card.suppliers).toEqual([
      { id: 'f-1', name: 'Sintex' },
      { id: 'f-2', name: 'Baumer' },
    ]);
  });

  it('devolve lista vazia de fornecedores quando nenhum foi escolhido', async () => {
    const { service } = makeService({ records: [buildRecord()] });

    const result = await service.findAllForKanban({}, 'user-1');

    expect((result.records[0] as Record<string, unknown>).suppliers).toEqual(
      [],
    );
  });

  it('não consulta fornecedores quando não há card nenhum', async () => {
    const { service, opmeItemRepository } = makeService({
      records: [],
      total: 0,
    });

    await service.findAllForKanban({}, 'user-1');

    expect(
      opmeItemRepository.findSelectedSuppliersByRequestIds,
    ).not.toHaveBeenCalled();
  });

  /**
   * SC não tem clínica própria: ela vem da consulta cuja ficha indicou a
   * cirurgia. O filtro de clínica do kanban depende deste campo.
   */
  it('leva a clínica da consulta de origem para o card', async () => {
    const { service, clinicalRecordRepository } = makeService({
      records: [buildRecord(), buildRecord({ id: 'sr-2' })],
      clinicRows: [
        {
          surgeryRequestId: 'sr-1',
          clinicId: 'c-1',
          clinicName: 'Unidade Centro',
        },
        // Linha de outra SC não pode vazar para este card.
        { surgeryRequestId: 'sr-9', clinicId: 'c-9', clinicName: 'Outra' },
      ],
    });

    const result = await service.findAllForKanban({}, 'user-1');

    expect(
      clinicalRecordRepository.findClinicsBySurgeryRequestIds,
    ).toHaveBeenCalledWith(['sr-1', 'sr-2']);
    const [comClinica, semClinica] = result.records as Array<
      Record<string, unknown>
    >;
    expect(comClinica.clinic).toEqual({ id: 'c-1', name: 'Unidade Centro' });
    // SC criada fora do atendimento (wizard, documento, WhatsApp).
    expect(semClinica.clinic).toBeNull();
  });

  it('não consulta clínicas quando não há card nenhum', async () => {
    const { service, clinicalRecordRepository } = makeService({
      records: [],
      total: 0,
    });

    await service.findAllForKanban({}, 'user-1');

    expect(
      clinicalRecordRepository.findClinicsBySurgeryRequestIds,
    ).not.toHaveBeenCalled();
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
      {} as never,
    );
    return { service, surgeryRequestRepository, opmeItemRepository };
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

  it('mapeia os fornecedores da agenda como referências, não texto', async () => {
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
      patient: null,
      doctor: null,
      healthPlan: null,
      procedure: null,
      pendenciesCount: 0,
      totalPendencies: 0,
      hasIncompletePayment: false,
    };
    const { service, opmeItemRepository } = makeService([record]);
    opmeItemRepository.findSelectedSuppliersByRequestIds.mockResolvedValue([
      { surgeryRequestId: 'sr-1', supplierId: 'f-1', supplierName: 'Sintex' },
    ]);

    const result = await service.findAgenda(
      { from: '2026-07-01', to: '2026-07-31' },
      'user-1',
    );

    expect((result.records[0] as Record<string, unknown>).suppliers).toEqual([
      { id: 'f-1', name: 'Sintex' },
    ]);
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
