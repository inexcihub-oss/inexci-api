import { SchedulingHandler } from './scheduling.handler';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';
import { SURGERY_REQUEST_EVENTS } from '../../events/surgery-request.events';

describe('SchedulingHandler.registerPatientDateSelection (B2)', () => {
  const from = 'whatsapp:+5511998877665';
  const phoneDigitCandidates = ['5511998877665', '11998877665'];

  const scDaClinicaA = {
    id: 'sc-a',
    status: SurgeryRequestStatus.IN_SCHEDULING,
    dateOptions: ['2026-11-10T13:00:00.000Z', '2026-11-12T13:00:00.000Z'],
    patient: { name: 'Ana', phone: '(11) 99887-7665' },
  };
  const scDaClinicaB = { ...scDaClinicaA, id: 'sc-b' };

  let repository: {
    findInSchedulingByPatientPhones: jest.Mock;
    updateIfStatus: jest.Mock;
  };
  let activityRepository: { create: jest.Mock };
  let selectionStore: { find: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let handler: SchedulingHandler;

  beforeEach(() => {
    repository = {
      findInSchedulingByPatientPhones: jest.fn().mockResolvedValue([]),
      updateIfStatus: jest.fn().mockResolvedValue(true),
    };
    activityRepository = { create: jest.fn().mockResolvedValue({}) };
    selectionStore = { find: jest.fn().mockResolvedValue(null) };
    eventEmitter = { emit: jest.fn() };
    handler = new SchedulingHandler(
      {} as never,
      repository as never,
      activityRepository as never,
      {} as never,
      {} as never,
      selectionStore as never,
      eventEmitter as never,
    );
  });

  const register = (selectedIndex = 1) =>
    handler.registerPatientDateSelection({
      from,
      phoneDigitCandidates,
      selectedIndex,
    });

  it('usa a SC do marcador (telefone → SC) mesmo com o paciente em agendamento em duas clínicas', async () => {
    selectionStore.find.mockResolvedValue('sc-b');
    repository.findInSchedulingByPatientPhones.mockImplementation(
      async (_phones: string[], options: { id?: string }) =>
        options.id === 'sc-b' ? [scDaClinicaB] : [scDaClinicaA, scDaClinicaB],
    );

    const result = await register(1);

    expect(result).toMatchObject({ kind: 'selected', selectedIndex: 1 });
    expect(repository.updateIfStatus).toHaveBeenCalledWith(
      'sc-b',
      SurgeryRequestStatus.IN_SCHEDULING,
      { selectedDateIndex: 1 },
    );
    expect(activityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ surgeryRequestId: 'sc-b', userId: null }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      SURGERY_REQUEST_EVENTS.UPDATED,
      { surgeryRequestId: 'sc-b', actorId: null },
    );
  });

  it('sem marcador e com mais de uma SC para o telefone, não grava nada (ambíguo)', async () => {
    repository.findInSchedulingByPatientPhones.mockResolvedValue([
      scDaClinicaA,
      scDaClinicaB,
    ]);

    const result = await register();

    expect(result).toEqual({ kind: 'ambiguous' });
    expect(repository.updateIfStatus).not.toHaveBeenCalled();
    expect(activityRepository.create).not.toHaveBeenCalled();
  });

  it('sem marcador e com uma única SC para o telefone, grava nela', async () => {
    repository.findInSchedulingByPatientPhones.mockResolvedValue([
      scDaClinicaA,
    ]);

    const result = await register(0);

    expect(result).toMatchObject({
      kind: 'selected',
      selectedIso: scDaClinicaA.dateOptions[0],
    });
    expect(repository.updateIfStatus).toHaveBeenCalledWith(
      'sc-a',
      SurgeryRequestStatus.IN_SCHEDULING,
      { selectedDateIndex: 0 },
    );
  });

  it('ignora marcador que não confere com o telefone/status no banco e cai na busca única', async () => {
    selectionStore.find.mockResolvedValue('sc-de-outro-telefone');
    repository.findInSchedulingByPatientPhones.mockImplementation(
      async (_phones: string[], options: { id?: string }) =>
        options.id ? [] : [scDaClinicaA],
    );

    const result = await register(0);

    expect(result).toMatchObject({ kind: 'selected' });
    expect(repository.updateIfStatus).toHaveBeenCalledWith(
      'sc-a',
      expect.anything(),
      expect.anything(),
    );
  });

  it('opção inexistente não grava', async () => {
    repository.findInSchedulingByPatientPhones.mockResolvedValue([
      scDaClinicaA,
    ]);

    await expect(register(2)).resolves.toEqual({ kind: 'invalid_option' });
    expect(repository.updateIfStatus).not.toHaveBeenCalled();
  });

  it('SC que saiu de Em Agendamento entre a leitura e a escrita vira not_found', async () => {
    repository.findInSchedulingByPatientPhones.mockResolvedValue([
      scDaClinicaA,
    ]);
    repository.updateIfStatus.mockResolvedValue(false);

    await expect(register(0)).resolves.toEqual({ kind: 'not_found' });
    expect(activityRepository.create).not.toHaveBeenCalled();
  });

  it('sem SC alguma devolve not_found', async () => {
    await expect(register()).resolves.toEqual({ kind: 'not_found' });
  });
});
