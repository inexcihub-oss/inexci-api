import { ReportsService } from './reports.service';

/**
 * Cobertura do dashboard consolidado (item 5.1 / P13): contagens via
 * COUNT FILTER numa query e endpoint único `dashboardFull`.
 */
describe('ReportsService — dashboard consolidado', () => {
  function makeService(overrides: {
    doctorIds?: string[];
    counts?: {
      total: number;
      scheduled: number;
      performed: number;
      invoiced: number;
    };
  }) {
    const accessControlService = {
      getAccessibleDoctorIds: jest
        .fn()
        .mockResolvedValue(overrides.doctorIds ?? ['d-1']),
    };
    const surgeryRequestRepository = {
      countsByStatus: jest
        .fn()
        .mockResolvedValue(
          overrides.counts ?? {
            total: 10,
            scheduled: 3,
            performed: 2,
            invoiced: 1,
          },
        ),
      sumInvoiced: jest
        .fn()
        .mockResolvedValue({ invoicedValue: 500, receivedValue: 200 }),
      totalByHealthPlan: jest.fn().mockResolvedValue([]),
      totalByStatus: jest.fn().mockResolvedValue([]),
      totalByHospital: jest.fn().mockResolvedValue([]),
      getTemporalEvolution: jest.fn().mockResolvedValue([]),
      getMonthlyEvolution: jest.fn().mockResolvedValue([]),
      getAverageCompletionTime: jest.fn().mockResolvedValue({ averageDays: 4 }),
      total: jest.fn().mockResolvedValue(0),
    };

    const service = new ReportsService(
      surgeryRequestRepository as never,
      accessControlService as never,
    );
    return { service, surgeryRequestRepository };
  }

  it('usa countsByStatus (1 query) para os 4 KPIs de contagem', async () => {
    const { service, surgeryRequestRepository } = makeService({
      counts: { total: 10, scheduled: 3, performed: 2, invoiced: 1 },
    });

    const result = await service.dashboard('user-1');

    expect(surgeryRequestRepository.countsByStatus).toHaveBeenCalledTimes(1);
    expect(surgeryRequestRepository.total).not.toHaveBeenCalled();
    expect(result.surgeryRequest.total).toBe(10);
    expect(result.surgeryRequest.totalScheduled).toBe(3);
    expect(result.surgeryRequest.totalPerformed).toBe(2);
    expect(result.surgeryRequest.totalInvoicedCount).toBe(1);
    expect(result.surgeryRequest.totalInvoicedValue).toBe(500);
    expect(result.surgeryRequest.totalReceivedValue).toBe(200);
  });

  it('dashboardFull reúne KPIs + evoluções + tempo médio + alertas', async () => {
    const { service } = makeService({});

    const result = await service.dashboardFull('user-1');

    expect(result).toHaveProperty('surgeryRequest');
    expect(result).toHaveProperty('temporalEvolution');
    expect(result).toHaveProperty('monthlyEvolution');
    expect(result).toHaveProperty('averageCompletionTime');
    expect(result).toHaveProperty('pendingNotifications');
    expect(result.averageCompletionTime.averageDays).toBe(4);
  });

  it('retorna zeros quando o usuário não enxerga médicos', async () => {
    const { service, surgeryRequestRepository } = makeService({ doctorIds: [] });

    const result = await service.dashboard('user-1');

    expect(result.surgeryRequest.total).toBe(0);
    expect(surgeryRequestRepository.countsByStatus).not.toHaveBeenCalled();
  });
});
