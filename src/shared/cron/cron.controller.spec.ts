import { StaleNotificationService } from 'src/modules/notifications/stale-notification.service';
import { WeeklySummaryService } from 'src/modules/notifications/weekly-summary.service';
import { AdminSystemService } from 'src/modules/admin/system/admin-system.service';
import { CronController } from './cron.controller';

describe('CronController', () => {
  const stale = {
    checkAndNotifyStaleRequests: jest.fn().mockResolvedValue(4),
  };
  const weekly = {
    sendWeeklySummariesForAllUsers: jest.fn().mockResolvedValue(9),
  };
  const system = {
    runManual: jest.fn(
      (_key: string, _input: unknown, executar: () => Promise<unknown>) =>
        executar(),
    ),
  };
  const controller = new CronController(
    stale as unknown as StaleNotificationService,
    weekly as unknown as WeeklySummaryService,
    system as unknown as AdminSystemService,
  );
  const admin = { adminId: 'admin-1', name: 'Ana', email: 'a@x.com' };

  beforeEach(() => jest.clearAllMocks());

  it('solicitações paradas passam pela trava e pela auditoria e mantêm { notified }', async () => {
    const result = await controller.checkStaleRequests(
      { reason: 'Cliente reclamou' },
      admin,
    );

    expect(result).toEqual({ notified: 4 });
    expect(system.runManual).toHaveBeenCalledWith(
      'stale_requests',
      { reason: 'Cliente reclamou', actorAdminId: 'admin-1' },
      expect.any(Function),
    );
  });

  it('resumo semanal passa pela trava e pela auditoria e mantém { dispatched }', async () => {
    const result = await controller.sendWeeklySummary(
      { reason: 'Reenviar resumo' },
      admin,
    );

    expect(result).toEqual({ dispatched: 9 });
    expect(system.runManual).toHaveBeenCalledWith(
      'weekly_summary',
      { reason: 'Reenviar resumo', actorAdminId: 'admin-1' },
      expect.any(Function),
    );
  });
});
