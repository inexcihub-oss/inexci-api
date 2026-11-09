import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SKIP_CONSENT_CHECK_KEY } from 'src/shared/guards/consents.guard';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { IS_PUBLIC_KEY } from 'src/shared/decorators/is-public.decorator';
import { AdminMetricsController } from './admin-metrics.controller';
import { AdminMetricsService } from './admin-metrics.service';
import { AdminMetricsOverviewQueryDto } from './dto/admin-metrics-query.dto';

describe('AdminMetricsController', () => {
  const service = { getOverview: jest.fn() };
  const controller = new AdminMetricsController(
    service as unknown as AdminMetricsService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('usa 30d por padrão e repassa o período informado', async () => {
    await controller.overview({});
    await controller.overview({ period: '12m' });

    expect(service.getOverview).toHaveBeenNthCalledWith(1, '30d');
    expect(service.getOverview).toHaveBeenNthCalledWith(2, '12m');
  });

  it.each([
    ['30d', 0],
    ['90d', 0],
    ['12m', 0],
    ['7d', 1],
    ['1y', 1],
  ])('period=%s gera %i erro(s) de validação', async (period, erros) => {
    const dto = plainToInstance(AdminMetricsOverviewQueryDto, { period });

    expect(await validate(dto)).toHaveLength(erros);
  });

  it('usa a sessão do painel, é pública para o JWT da clínica e pula consentimento', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminMetricsController),
    ).toEqual([AdminSessionGuard]);
    expect(
      Reflect.getMetadata(SKIP_CONSENT_CHECK_KEY, AdminMetricsController),
    ).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AdminMetricsController)).toBe(
      true,
    );
  });
});
