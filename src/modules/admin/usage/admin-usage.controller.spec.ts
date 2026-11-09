import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SKIP_CONSENT_CHECK_KEY } from 'src/shared/guards/consents.guard';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { IS_PUBLIC_KEY } from 'src/shared/decorators/is-public.decorator';
import { AdminUsageController } from './admin-usage.controller';
import { AdminUsageService } from './admin-usage.service';
import { AdminUsageInactiveQueryDto } from './dto/admin-usage-query.dto';

describe('AdminUsageController', () => {
  const service = { getUsage: jest.fn(), getInactive: jest.fn() };
  const controller = new AdminUsageController(
    service as unknown as AdminUsageService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('delega o uso ao service', async () => {
    await controller.usage({});

    expect(service.getUsage).toHaveBeenCalledWith({});
  });

  it('rejeita período invertido', () => {
    expect(() =>
      controller.usage({
        from: new Date('2026-10-02'),
        to: new Date('2026-10-01'),
      }),
    ).toThrow(BadRequestException);
    expect(service.getUsage).not.toHaveBeenCalled();
  });

  it('inativas usa 7 dias por padrão e repassa o valor informado', async () => {
    await controller.inactive({});
    await controller.inactive({ days: 30 });

    expect(service.getInactive).toHaveBeenNthCalledWith(1, 7);
    expect(service.getInactive).toHaveBeenNthCalledWith(2, 30);
  });

  it.each([
    ['7', 0],
    ['15', 0],
    ['30', 0],
    ['10', 1],
    ['0', 1],
    ['abc', 1],
  ])('days=%s gera %i erro(s) de validação', async (days, erros) => {
    const dto = plainToInstance(AdminUsageInactiveQueryDto, { days });

    expect(await validate(dto)).toHaveLength(erros);
  });

  it('usa a sessão do painel, é pública para o JWT da clínica e pula consentimento', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminUsageController)).toEqual([
      AdminSessionGuard,
    ]);
    expect(
      Reflect.getMetadata(SKIP_CONSENT_CHECK_KEY, AdminUsageController),
    ).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AdminUsageController)).toBe(true);
  });
});
