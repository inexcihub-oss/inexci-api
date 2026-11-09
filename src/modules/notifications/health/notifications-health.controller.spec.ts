import { ServiceUnavailableException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { HealthCheckService } from '@nestjs/terminus';
import { NotificationsHealthController } from './notifications-health.controller';
import { NotificationsHealthService } from './notifications-health.service';
import { AdminSessionGuard } from 'src/modules/admin/auth/admin-session.guard';
import { SKIP_CONSENT_CHECK_KEY } from 'src/shared/guards/consents.guard';
import { IS_PUBLIC_KEY } from 'src/shared/decorators/is-public.decorator';

describe('NotificationsHealthController', () => {
  const detalhado = {
    status: 'ok',
    info: { redis: { status: 'up', host: 'redis.interno', port: 6379 } },
    error: {},
    details: {},
  };
  const health = { check: jest.fn() };
  const controller = new NotificationsHealthController(
    health as unknown as HealthCheckService,
    {} as NotificationsHealthService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('a rota pública responde só o status, sem host, porta ou erro', async () => {
    health.check.mockResolvedValue(detalhado);

    const resposta = await controller.check();

    expect(resposta).toEqual({ status: 'ok' });
    expect(JSON.stringify(resposta)).not.toContain('redis.interno');
  });

  it('a rota pública devolve 503 genérico quando algum canal cai', async () => {
    health.check.mockRejectedValue(
      new ServiceUnavailableException({
        status: 'error',
        error: { smtp: { host: 'smtp.interno', error: 'ECONNREFUSED' } },
      }),
    );

    const erro = await controller.check().catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ServiceUnavailableException);
    const corpo = JSON.stringify(
      (erro as ServiceUnavailableException).getResponse(),
    );
    expect(corpo).not.toContain('smtp.interno');
    expect(corpo).not.toContain('ECONNREFUSED');
  });

  it('a rota pública é @Public e a detalhada exige a sessão do painel administrativo', () => {
    const { check, details } = NotificationsHealthController.prototype;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, check)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, check)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, details)).toEqual([
      AdminSessionGuard,
    ]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, details)).toBe(true);
    expect(Reflect.getMetadata(SKIP_CONSENT_CHECK_KEY, details)).toBe(true);
  });

  it('a rota detalhada devolve o resultado completo para o admin de plataforma', async () => {
    health.check.mockResolvedValue(detalhado);

    await expect(controller.details()).resolves.toEqual(detalhado);
  });
});
