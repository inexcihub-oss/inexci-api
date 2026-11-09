import { ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import { AdminSystemService } from './admin-system.service';
import { RunSystemJobDto } from './dto/system-jobs.dto';

function build() {
  const audit = {
    begin: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    succeed: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
    lastSucceeded: jest.fn().mockResolvedValue(new Map()),
  };
  const jobLock = {
    acquire: jest.fn().mockResolvedValue('trava-1'),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AdminSystemService(audit as never, jobLock as never);
  return { service, audit, jobLock };
}

describe('AdminSystemService.listJobs', () => {
  it('descreve as duas tarefas com a agenda dos @Cron e sem execução manual', async () => {
    const { service } = build();

    expect(await service.listJobs()).toEqual([
      expect.objectContaining({
        key: 'stale_requests',
        schedule: 'Todo dia às 07:00',
        lastManualRun: null,
      }),
      expect.objectContaining({
        key: 'weekly_summary',
        schedule: 'Domingos às 08:00',
        lastManualRun: null,
      }),
    ]);
  });

  it('lê a última execução manual da auditoria', async () => {
    const { service, audit } = build();
    const at = new Date('2026-10-27T10:00:00Z');
    audit.lastSucceeded.mockResolvedValue(
      new Map([
        [
          PlatformAuditAction.CRON_WEEKLY_SUMMARY_TRIGGERED,
          { at, by: 'Ana', result: { dispatched: 12 } },
        ],
      ]),
    );

    const jobs = await service.listJobs();

    expect(audit.lastSucceeded).toHaveBeenCalledWith([
      PlatformAuditAction.CRON_STALE_REQUESTS_TRIGGERED,
      PlatformAuditAction.CRON_WEEKLY_SUMMARY_TRIGGERED,
    ]);
    expect(jobs[1].lastManualRun).toEqual({
      at,
      by: 'Ana',
      result: { dispatched: 12 },
    });
    expect(jobs[0].lastManualRun).toBeNull();
  });
});

describe('AdminSystemService.runManual', () => {
  it('trava, audita com o motivo, executa e libera', async () => {
    const { service, audit, jobLock } = build();
    const executar = jest.fn().mockResolvedValue({ notified: 3 });

    const result = await service.runManual(
      'stale_requests',
      { reason: 'Cliente reclamou', actorAdminId: 'admin-1' },
      executar,
    );

    expect(result).toEqual({ notified: 3 });
    expect(jobLock.acquire).toHaveBeenCalledWith('system-job:stale_requests');
    expect(audit.begin).toHaveBeenCalledWith({
      actorAdminId: 'admin-1',
      action: PlatformAuditAction.CRON_STALE_REQUESTS_TRIGGERED,
      reason: 'Cliente reclamou',
    });
    expect(audit.succeed).toHaveBeenCalledWith('audit-1', {
      after: { notified: 3 },
    });
    expect(jobLock.release).toHaveBeenCalledWith(
      'system-job:stale_requests',
      'trava-1',
    );
  });

  it('tarefa já em execução responde 409 sem executar nem auditar', async () => {
    const { service, audit, jobLock } = build();
    jobLock.acquire.mockResolvedValue(null);
    const executar = jest.fn();

    await expect(
      service.runManual(
        'weekly_summary',
        { reason: 'Reenviar resumo', actorAdminId: 'admin-1' },
        executar,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(executar).not.toHaveBeenCalled();
    expect(audit.begin).not.toHaveBeenCalled();
    expect(jobLock.release).not.toHaveBeenCalled();
  });

  it('falha na execução marca a auditoria e libera a trava', async () => {
    const { service, audit, jobLock } = build();

    await expect(
      service.runManual(
        'weekly_summary',
        { reason: 'Reenviar resumo', actorAdminId: 'admin-1' },
        () => Promise.reject(new Error('smtp fora')),
      ),
    ).rejects.toThrow('smtp fora');
    expect(audit.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        action: PlatformAuditAction.CRON_WEEKLY_SUMMARY_TRIGGERED,
      }),
    );
    expect(audit.fail).toHaveBeenCalledWith('audit-1', 'smtp fora');
    expect(audit.succeed).not.toHaveBeenCalled();
    expect(jobLock.release).toHaveBeenCalledWith(
      'system-job:weekly_summary',
      'trava-1',
    );
  });
});

describe('RunSystemJobDto', () => {
  it('motivo é obrigatório e tem tamanho mínimo', async () => {
    expect(
      await validate(plainToInstance(RunSystemJobDto, {})),
    ).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(RunSystemJobDto, { reason: '  ab  ' })),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(RunSystemJobDto, { reason: 'Cliente reclamou' }),
      ),
    ).toHaveLength(0);
  });
});
