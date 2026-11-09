import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import { PaymentGatewayError } from 'src/shared/payment-gateway/payment-gateway.interface';
import { GatewayCoupon } from 'src/shared/payment-gateway/payment-gateway.types';
import { AdminCouponsService } from './admin-coupons.service';

describe('AdminCouponsService', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  const audit = {
    begin: jest.fn(),
    succeed: jest.fn(),
    fail: jest.fn(),
  };
  const planRepo = {
    findByIds: jest.fn(),
    findWithGatewayPrice: jest.fn(),
  };
  const invoiceRepo = { listCouponRedemptions: jest.fn() };
  const gateway = {
    createCoupon: jest.fn(),
    listCoupons: jest.fn(),
    getCoupon: jest.fn(),
    deactivateCoupon: jest.fn(),
    getPrice: jest.fn(),
  };
  const service = new AdminCouponsService(
    audit as never,
    planRepo as never,
    invoiceRepo as never,
    gateway as never,
  );

  const cupom = (over: Partial<GatewayCoupon> = {}): GatewayCoupon => ({
    id: 'promo_1',
    couponId: 'co_1',
    code: 'MAIO20',
    percentOff: 20,
    amountOffCents: null,
    currency: null,
    duration: 'repeating',
    durationInMonths: 3,
    maxRedemptions: 10,
    timesRedeemed: 2,
    expiresAt: new Date('2026-12-01T00:00:00Z'),
    active: true,
    valid: true,
    appliesToProductIds: [],
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...over,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    audit.begin.mockResolvedValue({ id: 'audit-1' });
    audit.succeed.mockResolvedValue(undefined);
    audit.fail.mockResolvedValue(undefined);
  });

  describe('list', () => {
    it('devolve situação derivada e nomes dos planos restritos', async () => {
      gateway.listCoupons.mockResolvedValue({
        hasMore: false,
        items: [
          cupom({ appliesToProductIds: ['prod_1'] }),
          cupom({ id: 'p2', maxRedemptions: 2, timesRedeemed: 2 }),
          cupom({ id: 'p3', expiresAt: new Date('2026-10-01T00:00:00Z') }),
          cupom({ id: 'p4', active: false }),
        ],
      });
      planRepo.findWithGatewayPrice.mockResolvedValue([
        { id: 'plan-m', name: 'Starter Mensal', gatewayPriceId: 'price_m' },
        { id: 'plan-a', name: 'Starter Anual', gatewayPriceId: 'price_a' },
        { id: 'plan-x', name: 'Outro', gatewayPriceId: 'price_x' },
      ]);
      gateway.getPrice.mockImplementation((id: string) =>
        Promise.resolve({
          id,
          productId: id === 'price_x' ? 'prod_9' : 'prod_1',
        }),
      );

      const result = await service.list(now);

      expect(gateway.listCoupons).toHaveBeenCalledWith(100);
      expect(result.items.map((c) => c.situation)).toEqual([
        'ativo',
        'esgotado',
        'expirado',
        'desativado',
      ]);
      expect(result.items[0]).toMatchObject({
        restrictedToPlans: true,
        plans: [
          { id: 'plan-m', name: 'Starter Mensal' },
          { id: 'plan-a', name: 'Starter Anual' },
        ],
      });
      expect(result.items[1]).toMatchObject({
        restrictedToPlans: false,
        plans: [],
      });
      expect(result.truncated).toBe(false);
    });

    const cem = () =>
      Array.from({ length: 100 }, (_, i) => cupom({ id: `p${i}` }));

    it('não consulta planos quando nenhum cupom é restrito e avisa do teto se há mais', async () => {
      gateway.listCoupons.mockResolvedValue({ items: cem(), hasMore: true });

      const result = await service.list(now);

      expect(planRepo.findWithGatewayPrice).not.toHaveBeenCalled();
      expect(result.truncated).toBe(true);
    });

    it('exatamente 100 sem mais páginas na Stripe não é truncado', async () => {
      gateway.listCoupons.mockResolvedValue({ items: cem(), hasMore: false });

      const result = await service.list(now);

      expect(result.items).toHaveLength(100);
      expect(result.truncated).toBe(false);
    });

    it('Stripe sem resposta vira 503', async () => {
      gateway.listCoupons.mockRejectedValue(
        new PaymentGatewayError('timeout', 'STRIPE_ERROR'),
      );

      await expect(service.list(now)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('create', () => {
    const base = {
      code: 'MAIO20',
      percentOff: 20,
      duration: 'repeating' as const,
      durationInMonths: 3,
    };

    it('audita antes, escreve na Stripe com o id da auditoria e registra o resultado', async () => {
      gateway.createCoupon.mockResolvedValue(cupom());

      const result = await service.create('admin-1', base, now);

      expect(audit.begin).toHaveBeenCalledWith({
        actorAdminId: 'admin-1',
        action: PlatformAuditAction.COUPON_CREATED,
        before: null,
      });
      expect(gateway.createCoupon).toHaveBeenCalledWith(
        {
          code: 'MAIO20',
          percentOff: 20,
          amountOffCents: undefined,
          duration: 'repeating',
          durationInMonths: 3,
          maxRedemptions: undefined,
          redeemBy: undefined,
          appliesToPriceIds: undefined,
        },
        'audit-1',
      );
      expect(audit.begin.mock.invocationCallOrder[0]).toBeLessThan(
        gateway.createCoupon.mock.invocationCallOrder[0],
      );
      expect(audit.succeed).toHaveBeenCalledWith('audit-1', {
        gatewayRef: 'promo_1',
        after: expect.objectContaining({
          code: 'MAIO20',
          percentOff: 20,
          duration: 'repeating',
          durationInMonths: 3,
          promotionCodeId: 'promo_1',
        }),
      });
      expect(result).toMatchObject({
        auditLogId: 'audit-1',
        coupon: { id: 'promo_1', code: 'MAIO20', situation: 'ativo' },
      });
    });

    it('traduz planIds em preços da Stripe e repassa redeemBy como Date', async () => {
      planRepo.findByIds.mockResolvedValue([
        { id: 'plan-1', name: 'Starter', gatewayPriceId: 'price_1' },
        { id: 'plan-2', name: 'Pro', gatewayPriceId: 'price_2' },
      ]);
      gateway.createCoupon.mockResolvedValue(
        cupom({ appliesToProductIds: ['prod_1'] }),
      );
      planRepo.findWithGatewayPrice.mockResolvedValue([]);

      await service.create(
        'admin-1',
        {
          ...base,
          planIds: ['plan-1', 'plan-2'],
          redeemBy: '2026-12-31T23:59:59Z',
        },
        now,
      );

      expect(gateway.createCoupon).toHaveBeenCalledWith(
        expect.objectContaining({
          appliesToPriceIds: ['price_1', 'price_2'],
          redeemBy: new Date('2026-12-31T23:59:59Z'),
        }),
        'audit-1',
      );
    });

    it('plano inexistente ou sem preço na Stripe vira 400 sem auditar nem chamar a Stripe', async () => {
      planRepo.findByIds.mockResolvedValueOnce([]);
      await expect(
        service.create('admin-1', { ...base, planIds: ['plan-x'] }, now),
      ).rejects.toBeInstanceOf(BadRequestException);

      planRepo.findByIds.mockResolvedValueOnce([
        { id: 'plan-e', name: 'Enterprise', gatewayPriceId: null },
      ]);
      await expect(
        service.create('admin-1', { ...base, planIds: ['plan-e'] }, now),
      ).rejects.toThrow(/Enterprise/);

      expect(audit.begin).not.toHaveBeenCalled();
      expect(gateway.createCoupon).not.toHaveBeenCalled();
    });

    it('redeemBy no passado vira 400', async () => {
      await expect(
        service.create(
          'admin-1',
          { ...base, redeemBy: '2026-01-01T00:00:00Z' },
          now,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(audit.begin).not.toHaveBeenCalled();
    });

    it('código duplicado na Stripe vira 409 e a auditoria fica failed', async () => {
      gateway.createCoupon.mockRejectedValue(
        new PaymentGatewayError('dup', 'COUPON_CODE_DUPLICATE', 409),
      );

      await expect(service.create('admin-1', base, now)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(audit.fail).toHaveBeenCalledWith('audit-1', 'dup');
      expect(audit.succeed).not.toHaveBeenCalled();
    });

    it.each([
      [undefined, ServiceUnavailableException],
      [429, ServiceUnavailableException],
      [400, BadRequestException],
      [500, BadGatewayException],
    ])(
      'erro da Stripe com status %s vira a exceção HTTP correta',
      async (status, klass) => {
        gateway.createCoupon.mockRejectedValue(
          new PaymentGatewayError('falhou', 'STRIPE_ERROR', status),
        );

        await expect(
          service.create('admin-1', base, now),
        ).rejects.toBeInstanceOf(klass);
        expect(audit.fail).toHaveBeenCalled();
      },
    );

    it('falha ao fechar a auditoria não derruba a criação já feita na Stripe', async () => {
      gateway.createCoupon.mockResolvedValue(cupom());
      audit.succeed.mockRejectedValue(new Error('db fora'));

      await expect(service.create('admin-1', base, now)).resolves.toMatchObject(
        {
          auditLogId: 'audit-1',
        },
      );
    });
  });

  describe('deactivate', () => {
    it('exige motivo de 5 a 500 caracteres', async () => {
      await expect(
        service.deactivate('promo_1', 'admin-1', 'abc', now),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(gateway.getCoupon).not.toHaveBeenCalled();
    });

    it('cupom inexistente é 404 e já desativado é 409, sem auditar', async () => {
      gateway.getCoupon.mockResolvedValueOnce(null);
      await expect(
        service.deactivate('promo_x', 'admin-1', 'campanha encerrada', now),
      ).rejects.toBeInstanceOf(NotFoundException);

      gateway.getCoupon.mockResolvedValueOnce(cupom({ active: false }));
      await expect(
        service.deactivate('promo_1', 'admin-1', 'campanha encerrada', now),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(audit.begin).not.toHaveBeenCalled();
    });

    it('audita com o motivo, desativa na Stripe com o id da auditoria e registra o resultado', async () => {
      gateway.getCoupon.mockResolvedValue(cupom());
      gateway.deactivateCoupon.mockResolvedValue(undefined);

      const result = await service.deactivate(
        'promo_1',
        'admin-1',
        '  campanha encerrada  ',
        now,
      );

      expect(audit.begin).toHaveBeenCalledWith({
        actorAdminId: 'admin-1',
        action: PlatformAuditAction.COUPON_DEACTIVATED,
        reason: 'campanha encerrada',
        before: { code: 'MAIO20', active: true },
      });
      expect(gateway.deactivateCoupon).toHaveBeenCalledWith(
        'promo_1',
        'audit-1',
      );
      expect(audit.succeed).toHaveBeenCalledWith('audit-1', {
        gatewayRef: 'promo_1',
        after: {
          code: 'MAIO20',
          active: false,
          reason: 'campanha encerrada',
        },
      });
      expect(result.coupon).toMatchObject({
        active: false,
        situation: 'desativado',
      });
    });

    it('falha na Stripe marca a auditoria como failed e propaga o erro mapeado', async () => {
      gateway.getCoupon.mockResolvedValue(cupom());
      gateway.deactivateCoupon.mockRejectedValue(
        new PaymentGatewayError('fora', 'STRIPE_ERROR'),
      );

      await expect(
        service.deactivate('promo_1', 'admin-1', 'campanha encerrada', now),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(audit.fail).toHaveBeenCalledWith('audit-1', 'fora');
      expect(audit.succeed).not.toHaveBeenCalled();
    });
  });

  describe('redemptions', () => {
    it('busca as faturas pelo código do cupom', async () => {
      gateway.getCoupon.mockResolvedValue(cupom({ timesRedeemed: 3 }));
      const rows = [
        { ownerId: 'o-1', ownerName: 'Clínica', ownerEmail: 'a@b.c' },
      ];
      invoiceRepo.listCouponRedemptions.mockResolvedValue(rows);

      const result = await service.redemptions('promo_1');

      expect(invoiceRepo.listCouponRedemptions).toHaveBeenCalledWith('MAIO20');
      expect(result).toEqual({ code: 'MAIO20', timesRedeemed: 3, items: rows });
    });

    it('cupom inexistente é 404', async () => {
      gateway.getCoupon.mockResolvedValue(null);

      await expect(service.redemptions('promo_x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
