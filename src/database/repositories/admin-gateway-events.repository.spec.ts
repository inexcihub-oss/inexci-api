import { Repository } from 'typeorm';
import { PaymentGatewayEvent } from '../entities/payment-gateway-event.entity';
import { AdminGatewayEventsRepository } from './admin-gateway-events.repository';

describe('AdminGatewayEventsRepository', () => {
  const query = jest.fn();
  const repo = { query } as unknown as Repository<PaymentGatewayEvent>;
  const repository = new AdminGatewayEventsRepository(repo);
  const staleBefore = new Date('2026-10-28T11:00:00Z');

  beforeEach(() => jest.resetAllMocks());

  it('resolve a conta pelo customer ou pela assinatura do payload, inclusive no formato novo da fatura', async () => {
    query.mockResolvedValue([
      {
        id: 'e-1',
        eventId: 'evt_1',
        eventType: 'invoice.paid',
        gatewayType: 'invoice.paid',
        createdAt: '2026-10-28T10:00:00.000Z',
        processedAt: null,
        error: null,
        customerId: 'cus_1',
        ownerId: 'o-1',
        ownerName: 'Clínica Alfa',
        payload: {},
        total: '3',
      },
    ]);

    const result = await repository.search({
      staleBefore,
      limit: 25,
      offset: 0,
    });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("'{data,object,customer}'");
    expect(sql).toContain(
      "'{data,object,parent,subscription_details,subscription}'",
    );
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).not.toContain('WHERE r.');
    expect(params).toEqual([25, 0]);
    expect(result.total).toBe(3);
    expect(result.items[0].createdAt).toEqual(
      new Date('2026-10-28T10:00:00.000Z'),
    );
  });

  it('filtra problemas e conta com parâmetros numerados na ordem', async () => {
    query.mockResolvedValue([]);

    const result = await repository.search({
      onlyProblems: true,
      ownerId: 'o-1',
      staleBefore,
      limit: 10,
      offset: 20,
    });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('r."processedAt" IS NULL');
    expect(sql).toContain('r."createdAt" < $1');
    expect(sql).toContain('r."ownerId" = $2');
    expect(sql).toContain('LIMIT $3 OFFSET $4');
    expect(params).toEqual([staleBefore, 'o-1', 10, 20]);
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('conta eventos com erro e pendentes antigos', async () => {
    query.mockResolvedValue([{ failed: '2', stalePending: '5' }]);
    await expect(repository.countProblems(staleBefore)).resolves.toEqual({
      failed: 2,
      stalePending: 5,
    });
    expect(query.mock.calls[0][1]).toEqual([staleBefore]);
  });

  it('busca um evento resolvido pelo id', async () => {
    query.mockResolvedValue([]);
    await expect(repository.findResolved('e-1')).resolves.toBeNull();
    expect(query.mock.calls[0][1]).toEqual(['e-1']);
  });
});
