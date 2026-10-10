import { LogRetentionService } from './log-retention.service';

describe('LogRetentionService', () => {
  const repoVazio = () => ({
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
  });

  function build(configValues: Record<string, unknown> = {}) {
    const notificationRepository = {
      deleteReadOlderThan: jest.fn().mockResolvedValue(3),
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
    );
    return { service, notificationRepository };
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
});
