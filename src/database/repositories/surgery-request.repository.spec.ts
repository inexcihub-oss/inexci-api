import { SurgeryRequestRepository } from './surgery-request.repository';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from '../entities/surgery-request.entity';
import { OpmeItem } from '../entities/opme-item.entity';
import { SurgeryRequestTussItem } from '../entities/surgery-request-tuss-item.entity';
import { Document } from '../entities/document.entity';
import { Contestation } from '../entities/contestation.entity';

describe('SurgeryRequestRepository.findOne', () => {
  const baseEntity = {
    id: 'sr-1',
    status: 1,
    healthPlanId: 'hp-1',
    patient: { id: 'p-1', name: 'Paciente', cpf: '123', email: 'a@a.com' },
    doctor: { id: 'd-1', doctorProfile: { signatureUrl: null } },
    procedure: { id: 'proc-1', name: 'Artroscopia' },
  } as unknown as SurgeryRequest;

  function buildRepo(overrides: {
    baseResult?: SurgeryRequest | null;
    opmeItems?: unknown[];
    tussItems?: unknown[];
    documents?: unknown[];
    contestations?: unknown[];
  }) {
    const mockRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue(
          overrides.baseResult === undefined
            ? baseEntity
            : overrides.baseResult,
        ),
    };

    const findByEntityName: Record<string, jest.Mock> = {
      OpmeItem: jest.fn().mockResolvedValue(overrides.opmeItems ?? []),
      SurgeryRequestTussItem: jest
        .fn()
        .mockResolvedValue(overrides.tussItems ?? []),
      Document: jest.fn().mockResolvedValue(overrides.documents ?? []),
      Contestation: jest.fn().mockResolvedValue(overrides.contestations ?? []),
    };

    const mockDataSource = {
      getRepository: jest.fn((entity: { name: string }) => ({
        find: findByEntityName[entity.name],
      })),
    };

    const repository = new SurgeryRequestRepository(
      mockRepository as any,
      mockDataSource as any,
    );

    return { repository, mockRepository, mockDataSource, findByEntityName };
  }

  it('retorna null e não busca coleções quando a SC base não existe', async () => {
    const { repository, mockDataSource } = buildRepo({ baseResult: null });

    const result = await repository.findOne({ id: 'sr-1' });

    expect(result).toBeNull();
    expect(mockDataSource.getRepository).not.toHaveBeenCalled();
  });

  it('carrega as 4 coleções to-many em paralelo, filtradas pelo id da SC base', async () => {
    const { repository, findByEntityName } = buildRepo({
      opmeItems: [{ id: 'o-1', surgeryRequestId: 'sr-1' }],
      tussItems: [{ id: 't-1', surgeryRequestId: 'sr-1' }],
      documents: [{ id: 'doc-1', surgeryRequestId: 'sr-1' }],
      contestations: [{ id: 'c-1', surgeryRequestId: 'sr-1' }],
    });

    const result = await repository.findOne({ id: 'sr-1' });

    expect(findByEntityName.OpmeItem).toHaveBeenCalledWith(
      expect.objectContaining({ where: { surgeryRequestId: 'sr-1' } }),
    );
    expect(findByEntityName.SurgeryRequestTussItem).toHaveBeenCalledWith(
      expect.objectContaining({ where: { surgeryRequestId: 'sr-1' } }),
    );
    expect(findByEntityName.Document).toHaveBeenCalledWith(
      expect.objectContaining({ where: { surgeryRequestId: 'sr-1' } }),
    );
    expect(findByEntityName.Contestation).toHaveBeenCalledWith(
      expect.objectContaining({ where: { surgeryRequestId: 'sr-1' } }),
    );

    expect(result?.opmeItems).toEqual([
      { id: 'o-1', surgeryRequestId: 'sr-1' },
    ]);
    expect(result?.tussItems).toEqual([
      { id: 't-1', surgeryRequestId: 'sr-1' },
    ]);
    expect(result?.documents).toEqual([
      { id: 'doc-1', surgeryRequestId: 'sr-1' },
    ]);
    expect(result?.contestations).toEqual([
      { id: 'c-1', surgeryRequestId: 'sr-1' },
    ]);
  });

  it('busca opmeItems com join das relações aninhadas (suppliers/manufacturers/selectedSupplier)', async () => {
    const { repository, findByEntityName } = buildRepo({});

    await repository.findOne({ id: 'sr-1' });

    expect(findByEntityName.OpmeItem).toHaveBeenCalledWith(
      expect.objectContaining({
        relationLoadStrategy: 'join',
        relations: {
          suppliers: true,
          manufacturers: true,
          selectedSupplier: true,
        },
      }),
    );
  });

  it('embute os contadores de pendência calculados a partir da entidade completa', async () => {
    const { repository } = buildRepo({});

    const result = await repository.findOne({ id: 'sr-1' });

    expect(result).toHaveProperty('pendenciesCount');
    expect(result).toHaveProperty('totalPendencies');
    expect(result).toHaveProperty('completedCount');
  });

  it('usa os mesmos entity classes esperados para as 4 coleções (OpmeItem, SurgeryRequestTussItem, Document, Contestation)', async () => {
    const { repository, mockDataSource } = buildRepo({});

    await repository.findOne({ id: 'sr-1' });

    const requestedEntities = mockDataSource.getRepository.mock.calls.map(
      (call: unknown[]) => (call[0] as { name: string }).name,
    );
    expect(requestedEntities).toEqual(
      expect.arrayContaining([
        OpmeItem.name,
        SurgeryRequestTussItem.name,
        Document.name,
        Contestation.name,
      ]),
    );
  });
});

describe('SurgeryRequestRepository.recordStatusChange', () => {
  function buildFakeManager() {
    const surgeryRequestRepo = { update: jest.fn().mockResolvedValue({}) };
    const activityRepo = { save: jest.fn().mockResolvedValue({}) };
    const manager = {
      getRepository: jest.fn((entity: { name: string }) => {
        if (entity.name === 'SurgeryRequest') return surgeryRequestRepo;
        if (entity.name === 'SurgeryRequestActivity') return activityRepo;
        throw new Error(`Entidade inesperada: ${entity.name}`);
      }),
    };
    return { manager, surgeryRequestRepo, activityRepo };
  }

  it('usa a data informada tanto para lastStatusChangedAt quanto para o createdAt da atividade', async () => {
    const repository = new SurgeryRequestRepository({} as any, {} as any);
    const { manager, surgeryRequestRepo, activityRepo } = buildFakeManager();
    const changedAt = new Date('2026-01-10T12:00:00Z');

    await repository.recordStatusChange(
      manager as any,
      'sr-1',
      SurgeryRequestStatus.PENDING,
      SurgeryRequestStatus.SENT,
      'user-1',
      changedAt,
    );

    expect(surgeryRequestRepo.update).toHaveBeenCalledWith('sr-1', {
      lastStatusChangedAt: changedAt,
    });
    expect(activityRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ createdAt: changedAt }),
    );
  });

  it('usa "agora" para os dois quando nenhuma data é informada (comportamento padrão)', async () => {
    const repository = new SurgeryRequestRepository({} as any, {} as any);
    const { manager, surgeryRequestRepo, activityRepo } = buildFakeManager();

    await repository.recordStatusChange(
      manager as any,
      'sr-1',
      SurgeryRequestStatus.PENDING,
      SurgeryRequestStatus.SENT,
      'user-1',
    );

    const [, updatePayload] = surgeryRequestRepo.update.mock.calls[0];
    const [activitySavePayload] = activityRepo.save.mock.calls[0];
    expect(activitySavePayload.createdAt).toEqual(
      updatePayload.lastStatusChangedAt,
    );
  });
});

describe('SurgeryRequestRepository.applyStatusTransition (UPDATE condicional)', () => {
  function buildManager(affected: number) {
    const surgeryRequestRepo = {
      update: jest.fn().mockResolvedValue({ affected }),
    };
    const activityRepo = { save: jest.fn().mockResolvedValue({}) };
    const manager = {
      getRepository: jest.fn((entity: { name: string }) =>
        entity.name === 'SurgeryRequest' ? surgeryRequestRepo : activityRepo,
      ),
    };
    return { manager, surgeryRequestRepo, activityRepo };
  }

  it('só atualiza a linha que ainda está no status de origem e registra a atividade', async () => {
    const repository = new SurgeryRequestRepository({} as any, {} as any);
    const { manager, surgeryRequestRepo, activityRepo } = buildManager(1);

    const applied = await repository.applyStatusTransition(manager as any, {
      id: 'sr-1',
      from: SurgeryRequestStatus.PENDING,
      to: SurgeryRequestStatus.SENT,
      data: { sendMethod: 'email' },
      userId: 'u-1',
    });

    expect(applied).toBe(true);
    expect(surgeryRequestRepo.update).toHaveBeenCalledWith(
      { id: 'sr-1', status: SurgeryRequestStatus.PENDING },
      { sendMethod: 'email', status: SurgeryRequestStatus.SENT },
    );
    expect(activityRepo.save).toHaveBeenCalledTimes(1);
  });

  it('devolve false e não grava atividade quando outra requisição já moveu a SC', async () => {
    const repository = new SurgeryRequestRepository({} as any, {} as any);
    const { manager, activityRepo } = buildManager(0);

    const applied = await repository.applyStatusTransition(manager as any, {
      id: 'sr-1',
      from: SurgeryRequestStatus.PENDING,
      to: SurgeryRequestStatus.SENT,
    });

    expect(applied).toBe(false);
    expect(activityRepo.save).not.toHaveBeenCalled();
  });

  it('updateIfStatus sem manager usa o repositório próprio', async () => {
    const own = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const repository = new SurgeryRequestRepository(own as any, {} as any);

    await expect(
      repository.updateIfStatus('sr-1', SurgeryRequestStatus.SCHEDULED, {
        surgeryDate: new Date('2026-05-01'),
      }),
    ).resolves.toBe(true);
    expect(own.update).toHaveBeenCalledWith(
      { id: 'sr-1', status: SurgeryRequestStatus.SCHEDULED },
      { surgeryDate: new Date('2026-05-01') },
    );
  });
});
