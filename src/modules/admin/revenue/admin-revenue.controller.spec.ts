import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SKIP_CONSENT_CHECK_KEY } from 'src/shared/guards/consents.guard';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { IS_PUBLIC_KEY } from 'src/shared/decorators/is-public.decorator';
import { AdminRevenueController } from './admin-revenue.controller';
import { AdminRevenueService } from './admin-revenue.service';

describe('AdminRevenueController', () => {
  const service = {
    getSummary: jest.fn(),
    getForecast: jest.fn(),
    listInvoices: jest.fn(),
    getDelinquency: jest.fn(),
    listPlans: jest.fn(),
  };
  const controller = new AdminRevenueController(
    service as unknown as AdminRevenueService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('resumo repassa o mês', async () => {
    await controller.summary({ month: '2026-10' });
    await controller.summary({});

    expect(service.getSummary).toHaveBeenNthCalledWith(1, '2026-10');
    expect(service.getSummary).toHaveBeenNthCalledWith(2, undefined);
  });

  it('previsão usa 6 meses por padrão', async () => {
    await controller.forecast({});
    await controller.forecast({ months: 12 });

    expect(service.getForecast).toHaveBeenNthCalledWith(1, 6);
    expect(service.getForecast).toHaveBeenNthCalledWith(2, 12);
  });

  it('faturas convertem datas e aplicam paginação padrão', async () => {
    await controller.invoices({
      status: 'paid',
      ownerId: 'o-1',
      from: '2026-10-01T03:00:00.000Z',
      to: '2026-11-01T03:00:00.000Z',
    });

    expect(service.listInvoices).toHaveBeenCalledWith({
      status: 'paid',
      ownerId: 'o-1',
      from: new Date('2026-10-01T03:00:00.000Z'),
      to: new Date('2026-11-01T03:00:00.000Z'),
      limit: 25,
      offset: 0,
    });
  });

  it('faturas rejeitam período invertido', () => {
    expect(() =>
      controller.invoices({
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      }),
    ).toThrow(BadRequestException);
    expect(service.listInvoices).not.toHaveBeenCalled();
  });

  it('faturas da conta filtram pelo ownerId', async () => {
    await controller.accountInvoices('o-1', { limit: 10, offset: 20 });

    expect(service.listInvoices).toHaveBeenCalledWith({
      ownerId: 'o-1',
      limit: 10,
      offset: 20,
    });
  });

  it('inadimplência e planos delegam ao service', async () => {
    await controller.delinquency();
    await controller.plans();

    expect(service.getDelinquency).toHaveBeenCalled();
    expect(service.listPlans).toHaveBeenCalled();
  });

  it('usa a sessão do painel, é pública para o JWT da clínica e pula consentimento', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminRevenueController),
    ).toEqual([AdminSessionGuard]);
    expect(
      Reflect.getMetadata(SKIP_CONSENT_CHECK_KEY, AdminRevenueController),
    ).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AdminRevenueController)).toBe(
      true,
    );
  });
});
