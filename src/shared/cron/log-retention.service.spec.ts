import { LogRetentionService } from './log-retention.service';

describe('LogRetentionService', () => {
  const repoVazio = () => ({
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
  });

  function build(configValues: Record<string, unknown> = {}) {
    const notificationRepository = {
      deleteReadOlderThan: jest.fn().mockResolvedValue(3),
    };
    const clinicalAccessAuditRepository = {
      deleteOlderThan: jest.fn().mockResolvedValue(0),
    };
    const platformErrorDailyRepository = {
      purgeBefore: jest.fn().mockResolvedValue(0),
    };
    const platformSecurityDailyRepository = {
      purgeBefore: jest.fn().mockResolvedValue(0),
    };
    const config = {
      get: jest.fn((key: string, def: unknown) =>
        key in configValues ? configValues[key] : def,
      ),
    };
    const service = new LogRetentionService(
      repoVazio() as never,
      repoVazio() as never,
      repoVazio() as never,
      repoVazio() as never,
      notificationRepository as never,
      config as never,
      clinicalAccessAuditRepository as never,
      platformErrorDailyRepository as never,
      platformSecurityDailyRepository as never,
    );
    return {
      service,
      notificationRepository,
      clinicalAccessAuditRepository,
      platformErrorDailyRepository,
      platformSecurityDailyRepository,
    };
  }

  it('apaga notificações lidas com mais de 90 dias por padrão', async () => {
    const { service, notificationRepository } = build();
    const antes = Date.now();

    await service.runDaily();

    expect(notificationRepository.deleteReadOlderThan).toHaveBeenCalledTimes(1);
    const [cutoff] = notificationRepository.deleteReadOlderThan.mock.calls[0];
    const dias = (antes - (cutoff as Date).getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(dias)).toBe(90);
  });

  it('desliga a limpeza quando a retenção é 0', async () => {
    const { service, notificationRepository } = build({
      LOG_RETENTION_READ_NOTIFICATION_DAYS: 0,
    });

    await service.runDaily();

    expect(notificationRepository.deleteReadOlderThan).not.toHaveBeenCalled();
  });

  it('falha na limpeza não derruba o ciclo', async () => {
    const { service, notificationRepository } = build();
    notificationRepository.deleteReadOlderThan.mockRejectedValue(
      new Error('db'),
    );

    await expect(service.runDaily()).resolves.toBeUndefined();
  });

  it('apaga auditoria de prontuário com mais de 5 anos por padrão', async () => {
    const { service, clinicalAccessAuditRepository } = build();
    const antes = Date.now();

    await service.runDaily();

    const [cutoff] = clinicalAccessAuditRepository.deleteOlderThan.mock
      .calls[0] as [Date];
    const dias = (antes - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(dias)).toBe(1825);
  });

  it('respeita LOG_RETENTION_CLINICAL_AUDIT_DAYS e falha não derruba o ciclo', async () => {
    const { service, clinicalAccessAuditRepository } = build({
      LOG_RETENTION_CLINICAL_AUDIT_DAYS: 0,
    });

    await service.runDaily();
    expect(
      clinicalAccessAuditRepository.deleteOlderThan,
    ).not.toHaveBeenCalled();

    const outro = build();
    outro.clinicalAccessAuditRepository.deleteOlderThan.mockRejectedValue(
      new Error('db'),
    );
    await expect(outro.service.runDaily()).resolves.toBeUndefined();
  });

  it('apaga contagens de erro com mais de 90 dias por padrão, pelo dia', async () => {
    const { service, platformErrorDailyRepository } = build();
    const esperado = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    await service.runDaily();

    expect(platformErrorDailyRepository.purgeBefore).toHaveBeenCalledWith(
      esperado,
    );
  });

  it('LOG_RETENTION_PLATFORM_ERROR_DAYS=0 desliga e falha não derruba o ciclo', async () => {
    const desligado = build({ LOG_RETENTION_PLATFORM_ERROR_DAYS: 0 });
    await desligado.service.runDaily();
    expect(
      desligado.platformErrorDailyRepository.purgeBefore,
    ).not.toHaveBeenCalled();

    const outro = build();
    outro.platformErrorDailyRepository.purgeBefore.mockRejectedValue(
      new Error('db'),
    );
    await expect(outro.service.runDaily()).resolves.toBeUndefined();
  });

  it('apaga contagens de segurança pelo dia e LOG_RETENTION_PLATFORM_SECURITY_DAYS=0 desliga', async () => {
    const { service, platformSecurityDailyRepository } = build();
    const esperado = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await service.runDaily();
    expect(platformSecurityDailyRepository.purgeBefore).toHaveBeenCalledWith(
      esperado,
    );

    const desligado = build({ LOG_RETENTION_PLATFORM_SECURITY_DAYS: 0 });
    await desligado.service.runDaily();
    expect(
      desligado.platformSecurityDailyRepository.purgeBefore,
    ).not.toHaveBeenCalled();

    const outro = build();
    outro.platformSecurityDailyRepository.purgeBefore.mockRejectedValue(
      new Error('db'),
    );
    await expect(outro.service.runDaily()).resolves.toBeUndefined();
  });
});
