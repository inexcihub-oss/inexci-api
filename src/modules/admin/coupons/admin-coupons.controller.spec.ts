import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SKIP_CONSENT_CHECK_KEY } from 'src/shared/guards/consents.guard';
import {
  AdminSessionGuard,
  AuthenticatedAdmin,
} from '../auth/admin-session.guard';
import { IS_PUBLIC_KEY } from 'src/shared/decorators/is-public.decorator';
import { AdminCouponsController } from './admin-coupons.controller';
import { AdminCouponsService } from './admin-coupons.service';
import { CreateCouponDto } from './dto/admin-coupons.dto';

describe('AdminCouponsController', () => {
  const service = {
    list: jest.fn(),
    create: jest.fn(),
    deactivate: jest.fn(),
    redemptions: jest.fn(),
  };
  const controller = new AdminCouponsController(
    service as unknown as AdminCouponsService,
  );
  const admin: AuthenticatedAdmin = {
    adminId: 'admin-1',
    name: 'Ana',
    email: 'ana@inexci.com',
  };

  beforeEach(() => jest.clearAllMocks());

  it('repassa o admin logado e os parâmetros da rota ao service', async () => {
    const dto = {
      code: 'MAIO20',
      percentOff: 20,
      duration: 'once' as const,
    };

    await controller.list();
    await controller.create(admin, dto);
    await controller.deactivate('promo_1', admin, {
      reason: 'campanha acabou',
    });
    await controller.redemptions('promo_1');

    expect(service.list).toHaveBeenCalledWith();
    expect(service.create).toHaveBeenCalledWith('admin-1', dto);
    expect(service.deactivate).toHaveBeenCalledWith(
      'promo_1',
      'admin-1',
      'campanha acabou',
    );
    expect(service.redemptions).toHaveBeenCalledWith('promo_1');
  });

  it('usa a sessão do painel, é pública para o JWT da clínica e pula consentimento', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminCouponsController),
    ).toEqual([AdminSessionGuard]);
    expect(
      Reflect.getMetadata(SKIP_CONSENT_CHECK_KEY, AdminCouponsController),
    ).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AdminCouponsController)).toBe(
      true,
    );
  });

  describe('validação do CreateCouponDto', () => {
    const errorsOf = async (body: object) =>
      (await validate(plainToInstance(CreateCouponDto, body))).map(
        (e) => e.property,
      );
    const futuro = new Date(Date.now() + 30 * 86400000).toISOString();

    it('aceita desconto percentual simples e converte o código para maiúsculas', async () => {
      const dto = plainToInstance(CreateCouponDto, {
        code: ' maio20 ',
        percentOff: 20,
        duration: 'once',
      });
      expect(await validate(dto)).toEqual([]);
      expect(dto.code).toBe('MAIO20');
    });

    it('código fora do padrão é recusado', async () => {
      for (const code of ['AB', 'a'.repeat(41), 'COM ESPACO', 'ÇÃO123', '']) {
        expect(
          await errorsOf({ code, percentOff: 10, duration: 'once' }),
        ).toContain('code');
      }
      expect(
        await errorsOf({ code: 'a_b9', percentOff: 10, duration: 'once' }),
      ).toContain('code');
      expect(
        await errorsOf({ code: 'abc-10', percentOff: 10, duration: 'once' }),
      ).toEqual([]);
    });

    it('exige exatamente um entre percentOff e amountOffCents', async () => {
      expect(await errorsOf({ code: 'ABC', duration: 'once' })).toContain(
        'percentOff',
      );
      expect(
        await errorsOf({
          code: 'ABC',
          duration: 'once',
          percentOff: 10,
          amountOffCents: 1000,
        }),
      ).toContain('percentOff');
      expect(
        await errorsOf({ code: 'ABC', duration: 'once', amountOffCents: 1000 }),
      ).toEqual([]);
    });

    it('percentOff fica entre 1 e 100 e amountOffCents é inteiro positivo', async () => {
      for (const percentOff of [0, 101, -5]) {
        expect(
          await errorsOf({ code: 'ABC', duration: 'once', percentOff }),
        ).toContain('percentOff');
      }
      expect(
        await errorsOf({ code: 'ABC', duration: 'once', percentOff: 100 }),
      ).toEqual([]);
      for (const amountOffCents of [0, -1, 10.5]) {
        expect(
          await errorsOf({ code: 'ABC', duration: 'once', amountOffCents }),
        ).toContain('amountOffCents');
      }
    });

    it('durationInMonths é obrigatório só para repeating', async () => {
      expect(
        await errorsOf({ code: 'ABC', percentOff: 10, duration: 'repeating' }),
      ).toContain('durationInMonths');
      expect(
        await errorsOf({
          code: 'ABC',
          percentOff: 10,
          duration: 'repeating',
          durationInMonths: 0,
        }),
      ).toContain('durationInMonths');
      expect(
        await errorsOf({
          code: 'ABC',
          percentOff: 10,
          duration: 'repeating',
          durationInMonths: 3,
        }),
      ).toEqual([]);
      for (const duration of ['once', 'forever']) {
        expect(
          await errorsOf({
            code: 'ABC',
            percentOff: 10,
            duration,
            durationInMonths: 3,
          }),
        ).toContain('durationInMonths');
        expect(
          await errorsOf({ code: 'ABC', percentOff: 10, duration }),
        ).toEqual([]);
      }
    });

    it('duration só aceita once, repeating ou forever', async () => {
      expect(
        await errorsOf({ code: 'ABC', percentOff: 10, duration: 'weekly' }),
      ).toContain('duration');
    });

    it('maxRedemptions e redeemBy são opcionais; redeemBy precisa ser futuro', async () => {
      expect(
        await errorsOf({
          code: 'ABC',
          percentOff: 10,
          duration: 'once',
          maxRedemptions: 50,
          redeemBy: futuro,
        }),
      ).toEqual([]);
      expect(
        await errorsOf({
          code: 'ABC',
          percentOff: 10,
          duration: 'once',
          maxRedemptions: 0,
        }),
      ).toContain('maxRedemptions');
      expect(
        await errorsOf({
          code: 'ABC',
          percentOff: 10,
          duration: 'once',
          redeemBy: '2020-01-01T00:00:00Z',
        }),
      ).toContain('redeemBy');
      expect(
        await errorsOf({
          code: 'ABC',
          percentOff: 10,
          duration: 'once',
          redeemBy: 'amanhã',
        }),
      ).toContain('redeemBy');
    });

    it('planIds precisa ser lista de UUIDs sem repetição', async () => {
      const base = { code: 'ABC', percentOff: 10, duration: 'once' };
      const id = '7f1a4c52-2b1e-4f63-9d0a-5a3c6e8b9d10';
      expect(await errorsOf({ ...base, planIds: [id] })).toEqual([]);
      expect(await errorsOf({ ...base, planIds: ['x'] })).toContain('planIds');
      expect(await errorsOf({ ...base, planIds: [id, id] })).toContain(
        'planIds',
      );
    });
  });
});
