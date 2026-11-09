import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import {
  AdminQueuesService,
  FILAS_INDISPONIVEIS,
  TAREFA_NAO_ENCONTRADA,
  TAREFA_SEM_FALHA,
} from './admin-queues.service';
import { ADMIN_QUEUES } from './admin-queues.catalog';

const OWNER = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function makeJob(over: Record<string, unknown> = {}) {
  return {
    id: '7',
    name: 'send-mail',
    data: {
      to: 'paciente@exemplo.com',
      subject: 'Conteúdo sigiloso',
      tenantId: OWNER,
    },
    opts: { attempts: 3 },
    attemptsMade: 3,
    failedReason: 'SMTP recusou paciente@exemplo.com com CPF 12345678901',
    timestamp: Date.parse('2026-10-28T10:00:00Z'),
    finishedOn: Date.parse('2026-10-28T10:05:00Z'),
    isFailed: jest.fn().mockResolvedValue(true),
    retry: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function makeQueue(over: Record<string, unknown> = {}) {
  return {
    getJobCounts: jest.fn().mockResolvedValue({
      waiting: 1,
      active: 2,
      delayed: 3,
      failed: 4,
      completed: 5,
    }),
    isPaused: jest.fn().mockResolvedValue(false),
    getFailed: jest.fn().mockResolvedValue([]),
    getFailedCount: jest.fn().mockResolvedValue(0),
    getJob: jest.fn().mockResolvedValue(null),
    ...over,
  };
}

describe('AdminQueuesService', () => {
  let queues: Record<string, ReturnType<typeof makeQueue>>;
  let lookup: { ownersOfUsers: jest.Mock; accountNames: jest.Mock };
  let audit: { begin: jest.Mock; succeed: jest.Mock; fail: jest.Mock };
  let service: AdminQueuesService;

  beforeEach(() => {
    queues = Object.fromEntries(ADMIN_QUEUES.map((q) => [q.name, makeQueue()]));
    lookup = {
      ownersOfUsers: jest.fn().mockResolvedValue(new Map()),
      accountNames: jest
        .fn()
        .mockResolvedValue(new Map([[OWNER, 'Clínica Alfa']])),
    };
    audit = {
      begin: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      succeed: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    service = new AdminQueuesService(
      queues['mail'] as never,
      queues['whatsapp-messages'] as never,
      queues['pdf-generation'] as never,
      queues['ai-messages'] as never,
      queues['document-extraction'] as never,
      queues['indication-documents'] as never,
      queues['mention-emails'] as never,
      lookup as never,
      audit as never,
    );
  });

  it('resume as contagens de todas as filas', async () => {
    const result = await service.overview();
    expect(result.queues).toHaveLength(ADMIN_QUEUES.length);
    expect(result.queues[0]).toMatchObject({
      name: 'mail',
      label: 'E-mails',
      waiting: 1,
      active: 2,
      delayed: 3,
      failed: 4,
      paused: false,
    });
  });

  it('Redis fora do ar vira 503 amigável', async () => {
    queues['mail'].getJobCounts.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(service.overview()).rejects.toEqual(
      new ServiceUnavailableException(FILAS_INDISPONIVEIS),
    );
  });

  it('Redis que não responde vira 503 depois do tempo limite', async () => {
    jest.useFakeTimers();
    queues['mail'].getJobCounts.mockReturnValue(new Promise(() => {}));
    const pending = service.overview();
    jest.advanceTimersByTime(3100);
    await expect(pending).rejects.toBeInstanceOf(ServiceUnavailableException);
    jest.useRealTimers();
  });

  it('lista falhas sem devolver o conteúdo do job e com o erro mascarado', async () => {
    queues['mail'].getFailed.mockResolvedValue([makeJob()]);
    queues['mail'].getFailedCount.mockResolvedValue(1);

    const result = await service.listFailed({
      queue: 'mail',
      limit: 25,
      offset: 0,
    });

    expect(queues['mail'].getFailed).toHaveBeenCalledWith(0, 24);
    expect(result.total).toBe(1);
    const [item] = result.items;
    expect(item).toMatchObject({
      id: '7',
      queue: 'mail',
      queueLabel: 'E-mails',
      ownerId: OWNER,
      ownerName: 'Clínica Alfa',
      attemptsMade: 3,
      maxAttempts: 3,
    });
    expect(item.error).not.toContain('paciente@exemplo.com');
    expect(item.error).not.toContain('12345678901');
    const json = JSON.stringify(result);
    expect(json).not.toContain('Conteúdo sigiloso');
    expect(json).not.toContain('paciente@exemplo.com');
  });

  it('resolve a conta pelo userId quando o job não traz tenant', async () => {
    queues['pdf-generation'].getFailed.mockResolvedValue([
      makeJob({ data: { surgeryRequestId: 'x', userId: USER } }),
    ]);
    lookup.ownersOfUsers.mockResolvedValue(new Map([[USER, OWNER]]));

    const result = await service.listFailed({
      queue: 'pdf-generation',
      limit: 10,
      offset: 0,
    });

    expect(lookup.ownersOfUsers).toHaveBeenCalledWith([USER]);
    expect(result.items[0].ownerId).toBe(OWNER);
  });

  it('sem fila escolhida, junta as filas pela data da falha e pagina', async () => {
    queues['mail'].getFailed.mockResolvedValue([
      makeJob({ id: 'a', finishedOn: 100 }),
    ]);
    queues['mail'].getFailedCount.mockResolvedValue(1);
    queues['whatsapp-messages'].getFailed.mockResolvedValue([
      makeJob({ id: 'b', finishedOn: 300 }),
      makeJob({ id: 'c', finishedOn: 200 }),
    ]);
    queues['whatsapp-messages'].getFailedCount.mockResolvedValue(2);

    const result = await service.listFailed({ limit: 2, offset: 0 });

    expect(result.items.map((i) => i.id)).toEqual(['b', 'c']);
    expect(result.total).toBe(3);
    expect(queues['mail'].getFailed).toHaveBeenCalledWith(0, 1);
  });

  it('fila desconhecida dá 404', async () => {
    await expect(
      service.listFailed({ queue: 'outra', limit: 10, offset: 0 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tentar de novo audita com a conta e chama retry', async () => {
    const job = makeJob();
    queues['mail'].getJob.mockResolvedValue(job);

    const result = await service.retry('mail', '7', 'Cliente pediu', 'adm-1');

    expect(audit.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        actorAdminId: 'adm-1',
        action: PlatformAuditAction.QUEUE_JOB_RETRIED,
        targetOwnerId: OWNER,
        reason: 'Cliente pediu',
      }),
    );
    expect(job.retry).toHaveBeenCalled();
    expect(job.remove).not.toHaveBeenCalled();
    expect(audit.succeed).toHaveBeenCalledWith('audit-1', expect.anything());
    expect(result).toEqual({
      auditLogId: 'audit-1',
      queue: 'mail',
      jobId: '7',
    });
  });

  it('descartar audita e remove o job', async () => {
    const job = makeJob();
    queues['mail'].getJob.mockResolvedValue(job);

    await service.discard('mail', '7', 'Duplicado', 'adm-1');

    expect(audit.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        action: PlatformAuditAction.QUEUE_JOB_DISCARDED,
      }),
    );
    expect(job.remove).toHaveBeenCalled();
  });

  it('job inexistente dá 404 sem auditar', async () => {
    await expect(
      service.retry('mail', '9', 'Motivo válido', 'adm-1'),
    ).rejects.toEqual(new NotFoundException(TAREFA_NAO_ENCONTRADA));
    expect(audit.begin).not.toHaveBeenCalled();
  });

  it('job que não está com falha dá 409 sem auditar', async () => {
    queues['mail'].getJob.mockResolvedValue(
      makeJob({ isFailed: jest.fn().mockResolvedValue(false) }),
    );
    await expect(
      service.discard('mail', '7', 'Motivo válido', 'adm-1'),
    ).rejects.toEqual(new ConflictException(TAREFA_SEM_FALHA));
    expect(audit.begin).not.toHaveBeenCalled();
  });

  it('falha no retry marca a auditoria como falha', async () => {
    const job = makeJob({
      retry: jest.fn().mockRejectedValue(new Error('Redis caiu')),
    });
    queues['mail'].getJob.mockResolvedValue(job);

    await expect(
      service.retry('mail', '7', 'Motivo válido', 'adm-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(audit.fail).toHaveBeenCalledWith('audit-1', 'Redis caiu');
    expect(audit.succeed).not.toHaveBeenCalled();
  });
});
