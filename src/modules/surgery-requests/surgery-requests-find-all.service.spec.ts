import { SurgeryRequestsService } from './surgery-requests.service';

/**
 * Cobertura do filtro por paciente em GET /surgery-requests. Antes, o frontend
 * baixava todas as SCs da conta e filtrava em memória.
 */
describe('SurgeryRequestsService.findAll', () => {
  function makeService(doctorIds: string[] = ['d-1']) {
    const accessControlService = {
      getAccessibleDoctorIds: jest.fn().mockResolvedValue(doctorIds),
      getOwnerId: jest.fn().mockResolvedValue('owner-1'),
    };
    const surgeryRequestRepository = {
      total: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([{ id: 'sr-1' }]),
    };

    const service = new SurgeryRequestsService(
      {} as never,
      accessControlService as never,
      {} as never,
      surgeryRequestRepository as never,
      {} as never,
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

    return { service, accessControlService, surgeryRequestRepository };
  }

  it('filtra por paciente quando patientId é informado', async () => {
    const { service, surgeryRequestRepository } = makeService();

    await service.findAll({ patientId: 'p-1' }, 'user-1');

    const whereArg = surgeryRequestRepository.findMany.mock.calls[0][0];
    expect(whereArg).toHaveProperty('patientId', 'p-1');
    // O escopo de tenant continua valendo junto com o novo filtro.
    expect(whereArg).toHaveProperty('doctorId');
    // O total precisa refletir o mesmo where, senão a paginação mente.
    expect(surgeryRequestRepository.total.mock.calls[0][0]).toHaveProperty(
      'patientId',
      'p-1',
    );
  });

  it('não adiciona patientId ao where quando não informado', async () => {
    const { service, surgeryRequestRepository } = makeService();

    await service.findAll({}, 'user-1');

    const whereArg = surgeryRequestRepository.findMany.mock.calls[0][0];
    expect(whereArg).not.toHaveProperty('patientId');
    expect(whereArg).toHaveProperty('doctorId');
  });

  it('retorna vazio sem consultar o repositório quando o usuário não enxerga médicos', async () => {
    const { service, surgeryRequestRepository } = makeService([]);

    const result = await service.findAll({ patientId: 'p-1' }, 'user-1');

    expect(result).toEqual({ total: 0, records: [] });
    expect(surgeryRequestRepository.findMany).not.toHaveBeenCalled();
  });

  it('filtra por hospital e por convênio somando ao escopo de tenant', async () => {
    const { service, surgeryRequestRepository } = makeService();

    await service.findAll(
      { hospitalId: 'h-1', healthPlanId: 'hp-1' },
      'user-1',
    );

    const whereArg = surgeryRequestRepository.findMany.mock.calls[0][0];
    expect(whereArg).toHaveProperty('hospitalId', 'h-1');
    expect(whereArg).toHaveProperty('healthPlanId', 'hp-1');
    expect(whereArg).toHaveProperty('doctorId');
    expect(surgeryRequestRepository.total.mock.calls[0][0]).toHaveProperty(
      'hospitalId',
      'h-1',
    );
  });

  it('estreita o escopo para um médico acessível quando doctorId é informado', async () => {
    const { service, surgeryRequestRepository } = makeService(['d-1', 'd-2']);

    await service.findAll({ doctorId: 'd-2' }, 'user-1');

    const whereArg = surgeryRequestRepository.findMany.mock.calls[0][0];
    // Deixa de ser In([d-1, d-2]) e passa a ser exatamente d-2.
    expect(whereArg.doctorId).toBe('d-2');
  });

  it('devolve vazio quando o doctorId pedido está fora dos acessíveis', async () => {
    const { service, surgeryRequestRepository } = makeService(['d-1']);

    const result = await service.findAll({ doctorId: 'd-99' }, 'user-1');

    expect(result).toEqual({ total: 0, records: [] });
    expect(surgeryRequestRepository.findMany).not.toHaveBeenCalled();
    expect(surgeryRequestRepository.total).not.toHaveBeenCalled();
  });
});
