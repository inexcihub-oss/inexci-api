import { SurgeryRequestRepository } from './surgery-request.repository';
import { SurgeryRequest } from '../entities/surgery-request.entity';
import { OpmeItem } from '../entities/opme-item.entity';
import { SurgeryRequestTussItem } from '../entities/surgery-request-tuss-item.entity';
import { Document } from '../entities/document.entity';
import { Contestation } from '../entities/contestation.entity';

/**
 * Cobertura da Fase 2 do plano de otimização (§4): `findOne` (detalhe da SC)
 * passa a carregar as 4 coleções to-many (`opmeItems`, `tussItems`,
 * `documents`, `contestations`) em paralelo via `Promise.all`, filtradas pelo
 * `id` já resolvido no bloco base — em vez de `relationLoadStrategy: 'query'`
 * encadeando round-trips sequenciais.
 */
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
