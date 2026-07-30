import { SurgicalIndicationService } from './surgical-indication.service';

describe('SurgicalIndicationService', () => {
  let service: SurgicalIndicationService;

  const recordRepo = { findOne: jest.fn(), update: jest.fn() };
  const manager = { getRepository: jest.fn(() => recordRepo) };
  const dataSource = {
    transaction: jest.fn((fn: (m: unknown) => Promise<unknown>) => fn(manager)),
  };
  const clinicalRecordRepository = {
    findPendingSurgicalIndications: jest.fn(),
  };
  const fromIndication = { createPendingFromIndication: jest.fn() };
  const realtime = { broadcastChange: jest.fn() };

  const finalizedRecord = {
    id: 'cr-1',
    ownerId: 'owner-1',
    doctorId: 'doctor-1',
    patientId: 'patient-1',
    surgicalIndication: true,
    surgeryRequestId: null,
    finalizedAt: new Date(),
    cidCodes: [{ code: 'M17.1', description: 'Gonartrose' }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    recordRepo.findOne.mockResolvedValue(finalizedRecord);
    recordRepo.update.mockResolvedValue({ affected: 1 });
    fromIndication.createPendingFromIndication.mockResolvedValue({
      id: 'sc-1',
    });
    realtime.broadcastChange.mockResolvedValue(undefined);

    service = new SurgicalIndicationService(
      dataSource as never,
      clinicalRecordRepository as never,
      fromIndication as never,
      realtime as never,
    );
  });

  describe('createForRecord', () => {
    it('cria a SC com os dados da ficha e grava o vínculo', async () => {
      const sc = await service.createForRecord('cr-1', 'user-1');

      expect(sc).toEqual({ id: 'sc-1' });
      expect(fromIndication.createPendingFromIndication).toHaveBeenCalledWith(
        expect.objectContaining({
          manager,
          ownerId: 'owner-1',
          doctorId: 'doctor-1',
          // createdById é o médico da ficha, não o usuário logado: o sweeper
          // roda sem ator e as duas rotas precisam gerar SCs idênticas.
          createdById: 'doctor-1',
          patientId: 'patient-1',
          cidCode: 'M17.1',
        }),
      );
      expect(recordRepo.update).toHaveBeenCalledWith('cr-1', {
        surgeryRequestId: 'sc-1',
      });
    });

    it('lê a ficha com lock de escrita para serializar com o sweeper', async () => {
      await service.createForRecord('cr-1');

      expect(recordRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'cr-1' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('não cria nada quando a ficha já tem SC', async () => {
      recordRepo.findOne.mockResolvedValue({
        ...finalizedRecord,
        surgeryRequestId: 'sc-existente',
      });

      const sc = await service.createForRecord('cr-1');

      expect(sc).toBeNull();
      expect(fromIndication.createPendingFromIndication).not.toHaveBeenCalled();
      expect(realtime.broadcastChange).not.toHaveBeenCalled();
    });

    it('não cria nada quando a ficha não tem o marcador', async () => {
      recordRepo.findOne.mockResolvedValue({
        ...finalizedRecord,
        surgicalIndication: false,
      });

      expect(await service.createForRecord('cr-1')).toBeNull();
      expect(fromIndication.createPendingFromIndication).not.toHaveBeenCalled();
    });

    it('não cria nada quando a ficha ainda não foi finalizada', async () => {
      recordRepo.findOne.mockResolvedValue({
        ...finalizedRecord,
        finalizedAt: null,
      });

      expect(await service.createForRecord('cr-1')).toBeNull();
      expect(fromIndication.createPendingFromIndication).not.toHaveBeenCalled();
    });

    it('não cria nada quando a ficha não existe', async () => {
      recordRepo.findOne.mockResolvedValue(null);

      expect(await service.createForRecord('cr-1')).toBeNull();
      expect(fromIndication.createPendingFromIndication).not.toHaveBeenCalled();
    });

    it('aceita ficha sem CID', async () => {
      recordRepo.findOne.mockResolvedValue({
        ...finalizedRecord,
        cidCodes: null,
      });

      await service.createForRecord('cr-1');

      expect(fromIndication.createPendingFromIndication).toHaveBeenCalledWith(
        expect.objectContaining({ cidCode: null }),
      );
    });

    it('avisa o kanban de todos com acesso ao médico, após a transação', async () => {
      await service.createForRecord('cr-1', 'user-1');

      expect(realtime.broadcastChange).toHaveBeenCalledWith(
        'sc-1',
        'created',
        'user-1',
      );
      // Fora da transação: o broadcast relê a SC no banco e não veria uma linha
      // ainda não commitada.
      const transactionCall =
        dataSource.transaction.mock.invocationCallOrder[0];
      const broadcastCall =
        realtime.broadcastChange.mock.invocationCallOrder[0];
      expect(broadcastCall).toBeGreaterThan(transactionCall);
    });

    it('não desfaz a SC quando o broadcast falha', async () => {
      realtime.broadcastChange.mockRejectedValue(new Error('socket caiu'));

      const sc = await service.createForRecord('cr-1');

      expect(sc).toEqual({ id: 'sc-1' });
      expect(recordRepo.update).toHaveBeenCalled();
    });
  });

  describe('sweepPendingIndications', () => {
    it('cria a SC de cada ficha pendente', async () => {
      clinicalRecordRepository.findPendingSurgicalIndications.mockResolvedValue(
        [{ id: 'cr-1' }, { id: 'cr-2' }],
      );

      const created = await service.sweepPendingIndications();

      expect(created).toBe(2);
      expect(recordRepo.findOne).toHaveBeenCalledTimes(2);
    });

    it('uma ficha com erro não impede as demais', async () => {
      clinicalRecordRepository.findPendingSurgicalIndications.mockResolvedValue(
        [{ id: 'cr-1' }, { id: 'cr-2' }],
      );
      recordRepo.findOne
        .mockRejectedValueOnce(new Error('deadlock'))
        .mockResolvedValueOnce(finalizedRecord);

      expect(await service.sweepPendingIndications()).toBe(1);
    });

    it('não conta ficha que já tinha SC', async () => {
      clinicalRecordRepository.findPendingSurgicalIndications.mockResolvedValue(
        [{ id: 'cr-1' }],
      );
      recordRepo.findOne.mockResolvedValue({
        ...finalizedRecord,
        surgeryRequestId: 'sc-existente',
      });

      expect(await service.sweepPendingIndications()).toBe(0);
    });
  });
});
