import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import type { AdminGatewayEventRow } from 'src/database/repositories/admin-gateway-events.repository';
import {
  AdminGatewayEventsService,
  EVENTO_JA_PROCESSADO,
} from './admin-gateway-events.service';
import { SUBSCRIPTION_NOT_IDENTIFIED } from './gateway-event-labels';

const NOW = new Date('2026-10-28T12:00:00Z');

function row(over: Partial<AdminGatewayEventRow> = {}): AdminGatewayEventRow {
  return {
    id: 'e-1',
    eventId: 'evt_1',
    eventType: 'invoice.paid',
    gatewayType: 'invoice.paid',
    createdAt: new Date('2026-10-28T11:30:00Z'),
    processedAt: new Date('2026-10-28T11:30:01Z'),
    error: null,
    customerId: 'cus_1',
    ownerId: 'o-1',
    ownerName: 'Clínica Alfa',
    payload: { id: 'evt_1' },
    ...over,
  };
}

describe('AdminGatewayEventsService', () => {
  let repository: {
    search: jest.Mock;
    findResolved: jest.Mock;
    countProblems: jest.Mock;
  };
  let webhook: { reprocessStored: jest.Mock };
  let audit: { begin: jest.Mock; succeed: jest.Mock; fail: jest.Mock };
  let gateway: { parseWebhookEvent: jest.Mock };
  let service: AdminGatewayEventsService;

  beforeEach(() => {
    repository = {
      search: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findResolved: jest.fn(),
      countProblems: jest
        .fn()
        .mockResolvedValue({ failed: 2, stalePending: 1 }),
    };
    webhook = { reprocessStored: jest.fn() };
    audit = {
      begin: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      succeed: jest.fn(),
      fail: jest.fn(),
    };
    gateway = {
      parseWebhookEvent: jest
        .fn()
        .mockReturnValue({ refs: { subscriptionId: 'sub_1' } }),
    };
    service = new AdminGatewayEventsService(
      repository as never,
      webhook as never,
      audit as never,
      gateway as never,
    );
  });

  it('lista com situação, rótulo em português e contadores, considerando pendente há mais de 1 h', async () => {
    repository.search.mockResolvedValue({
      items: [
        row(),
        row({
          id: 'e-2',
          processedAt: null,
          error: 'Falhou para paciente@exemplo.com',
        }),
        row({
          id: 'e-3',
          processedAt: null,
          createdAt: new Date('2026-10-28T10:00:00Z'),
        }),
        row({
          id: 'e-4',
          processedAt: null,
          createdAt: new Date('2026-10-28T11:59:00Z'),
        }),
      ],
      total: 4,
    });

    const result = await service.list(
      { problems: true, limit: 25, offset: 0 },
      NOW,
    );

    expect(repository.search).toHaveBeenCalledWith(
      expect.objectContaining({
        onlyProblems: true,
        staleBefore: new Date('2026-10-28T11:00:00Z'),
      }),
    );
    expect(result.counts).toEqual({ failed: 2, stalePending: 1 });
    expect(result.items.map((i) => [i.situation, i.stale])).toEqual([
      ['processed', false],
      ['failed', false],
      ['pending', true],
      ['pending', false],
    ]);
    expect(result.items[0].label).toBe('Fatura paga');
    expect(result.items[1].error).not.toContain('paciente@exemplo.com');
  });

  it('avisa quando a plataforma não identificou a assinatura do evento (efeito do extractRefs)', async () => {
    gateway.parseWebhookEvent.mockReturnValue({ refs: {} });
    repository.search.mockResolvedValue({
      items: [row(), row({ id: 'e-2', eventType: 'invoice.finalized' })],
      total: 2,
    });

    const result = await service.list({ limit: 25, offset: 0 }, NOW);

    expect(result.items[0]).toMatchObject({
      subscriptionRef: null,
      warning: SUBSCRIPTION_NOT_IDENTIFIED,
    });
    expect(result.items[1].warning).toBeNull();
  });

  it('payload ilegível não derruba a lista', async () => {
    gateway.parseWebhookEvent.mockImplementation(() => {
      throw new Error('quebrado');
    });
    repository.search.mockResolvedValue({ items: [row()], total: 1 });

    const result = await service.list({ limit: 25, offset: 0 }, NOW);

    expect(result.items[0].subscriptionRef).toBeNull();
  });

  it('reprocessa com auditoria vinculada à conta', async () => {
    repository.findResolved.mockResolvedValue(
      row({ processedAt: null, error: 'boom' }),
    );
    const processedAt = new Date('2026-10-28T12:01:00Z');
    webhook.reprocessStored.mockResolvedValue({
      id: 'e-1',
      eventId: 'evt_1',
      processedAt,
    });

    const result = await service.reprocess('e-1', 'Stripe voltou', 'adm-1');

    expect(audit.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        actorAdminId: 'adm-1',
        action: PlatformAuditAction.STRIPE_EVENT_REPROCESSED,
        targetOwnerId: 'o-1',
        reason: 'Stripe voltou',
      }),
    );
    expect(webhook.reprocessStored).toHaveBeenCalledWith('e-1');
    expect(audit.succeed).toHaveBeenCalledWith(
      'audit-1',
      expect.objectContaining({ gatewayRef: 'evt_1' }),
    );
    expect(result).toEqual({ auditLogId: 'audit-1', id: 'e-1', processedAt });
  });

  it('evento já processado dá 409 sem auditar', async () => {
    repository.findResolved.mockResolvedValue(row());
    await expect(
      service.reprocess('e-1', 'Motivo válido', 'adm-1'),
    ).rejects.toEqual(new ConflictException(EVENTO_JA_PROCESSADO));
    expect(audit.begin).not.toHaveBeenCalled();
  });

  it('evento inexistente dá 404', async () => {
    repository.findResolved.mockResolvedValue(null);
    await expect(
      service.reprocess('e-1', 'Motivo válido', 'adm-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('falha ao reprocessar marca a auditoria e devolve 422 com o erro mascarado', async () => {
    repository.findResolved.mockResolvedValue(row({ processedAt: null }));
    webhook.reprocessStored.mockRejectedValue(
      new Error('Cliente 12345678901 sem assinatura'),
    );

    const err = await service
      .reprocess('e-1', 'Motivo válido', 'adm-1')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect((err as Error).message).not.toContain('12345678901');
    expect(audit.fail).toHaveBeenCalledWith(
      'audit-1',
      expect.not.stringContaining('12345678901'),
      'evt_1',
    );
  });
});
