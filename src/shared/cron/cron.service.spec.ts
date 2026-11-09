import { ServiceUnavailableException } from '@nestjs/common';
import { CronService } from './cron.service';

function build() {
  const stale = { checkAndNotifyStaleRequests: jest.fn().mockResolvedValue(3) };
  const weekly = {
    sendWeeklySummariesForAllUsers: jest.fn().mockResolvedValue(5),
  };
  const lock = {
    acquire: jest.fn().mockResolvedValue('tok'),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CronService(
    stale as never,
    weekly as never,
    {} as never,
    { get: jest.fn() } as never,
    {} as never,
    lock as never,
  );
  return { service, stale, weekly, lock };
}

describe('CronService — trava das tarefas compartilhada com o painel', () => {
  it('resumo semanal agendado pega a mesma trava da execução manual e libera no fim', async () => {
    const { service, weekly, lock } = build();

    await service.handleWeeklySummary();

    expect(lock.acquire).toHaveBeenCalledWith('system-job:weekly_summary');
    expect(weekly.sendWeeklySummariesForAllUsers).toHaveBeenCalledTimes(1);
    expect(lock.release).toHaveBeenCalledWith(
      'system-job:weekly_summary',
      'tok',
    );
  });

  it('pula o resumo semanal quando a execução manual está em andamento', async () => {
    const { service, weekly, lock } = build();
    lock.acquire.mockResolvedValue(null);

    await service.handleWeeklySummary();

    expect(weekly.sendWeeklySummariesForAllUsers).not.toHaveBeenCalled();
    expect(lock.release).not.toHaveBeenCalled();
  });

  it('pula a verificação de paradas quando já está em execução', async () => {
    const { service, stale, lock } = build();
    lock.acquire.mockResolvedValue(null);

    await service.handleStaleNotifications();

    expect(lock.acquire).toHaveBeenCalledWith('system-job:stale_requests');
    expect(stale.checkAndNotifyStaleRequests).not.toHaveBeenCalled();
  });

  it('libera a trava mesmo quando a tarefa falha', async () => {
    const { service, stale, lock } = build();
    stale.checkAndNotifyStaleRequests.mockRejectedValue(new Error('db fora'));

    await service.handleStaleNotifications();

    expect(lock.release).toHaveBeenCalledWith(
      'system-job:stale_requests',
      'tok',
    );
  });

  it('com o Redis fora, executa sem a trava em vez de perder o agendamento', async () => {
    const { service, stale, lock } = build();
    lock.acquire.mockRejectedValue(new ServiceUnavailableException());

    await service.handleStaleNotifications();

    expect(stale.checkAndNotifyStaleRequests).toHaveBeenCalledTimes(1);
    expect(lock.release).not.toHaveBeenCalled();
  });
});
