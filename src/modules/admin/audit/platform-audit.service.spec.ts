import {
  PlatformAuditAction,
  PlatformAuditStatus,
} from 'src/database/entities/platform-audit-log.entity';
import { PlatformAuditLogRepository } from 'src/database/repositories/platform-audit-log.repository';
import { PlatformAuditService } from './platform-audit.service';

describe('PlatformAuditService', () => {
  const repository = {
    create: jest.fn(),
    markSucceeded: jest.fn(),
    markFailed: jest.fn(),
    search: jest.fn(),
  };
  const service = new PlatformAuditService(
    repository as unknown as PlatformAuditLogRepository,
  );

  beforeEach(() => jest.clearAllMocks());

  it('begin grava a ação como pending', async () => {
    repository.create.mockImplementation((data: object) =>
      Promise.resolve({ id: 'log-1', ...data }),
    );

    const log = await service.begin({
      actorAdminId: 'adm-1',
      action: PlatformAuditAction.TRIAL_EXTENDED,
      targetOwnerId: 'owner-1',
      reason: 'cliente pediu',
      before: { trialEndsAt: '2026-11-01' },
    });

    expect(repository.create).toHaveBeenCalledWith({
      actorAdminId: 'adm-1',
      action: PlatformAuditAction.TRIAL_EXTENDED,
      targetOwnerId: 'owner-1',
      targetUserId: null,
      targetAdminId: null,
      reason: 'cliente pediu',
      before: { trialEndsAt: '2026-11-01' },
      status: PlatformAuditStatus.PENDING,
    });
    expect(log.id).toBe('log-1');
  });

  it('ciclo pending para succeeded grava after e gatewayRef', async () => {
    await service.succeed('log-1', {
      after: { trialEndsAt: '2026-11-15' },
      gatewayRef: 'sub_123',
    });

    expect(repository.markSucceeded).toHaveBeenCalledWith('log-1', {
      after: { trialEndsAt: '2026-11-15' },
      gatewayRef: 'sub_123',
    });
  });

  it('succeed sem dados grava nulos', async () => {
    await service.succeed('log-1');

    expect(repository.markSucceeded).toHaveBeenCalledWith('log-1', {
      after: null,
      gatewayRef: null,
    });
  });

  it('ciclo pending para failed grava o erro', async () => {
    await service.fail('log-1', 'Stripe indisponível');

    expect(repository.markFailed).toHaveBeenCalledWith(
      'log-1',
      'Stripe indisponível',
      null,
    );
  });

  it('failed guarda a referência da Stripe quando a falha veio depois dela', async () => {
    await service.fail('log-1', 'banco caiu', 'sub_123');

    expect(repository.markFailed).toHaveBeenCalledWith(
      'log-1',
      'banco caiu',
      'sub_123',
    );
  });

  it('list repassa o filtro por conta e devolve itens e total', async () => {
    const resposta = {
      items: [{ id: 'log-1', actorName: 'Ana', actorEmail: 'ana@inexci.com' }],
      total: 1,
    };
    repository.search.mockResolvedValue(resposta);
    const filtro = { targetOwnerId: 'owner-1', limit: 20, offset: 0 };

    const result = await service.list(filtro);

    expect(repository.search).toHaveBeenCalledWith(filtro);
    expect(result).toEqual(resposta);
  });
});
