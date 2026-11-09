import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import { GatewayInvoiceRepository } from 'src/database/repositories/gateway-invoice.repository';
import { SubscriptionPlanRepository } from 'src/database/repositories/subscription-plan.repository';
import {
  PAYMENT_GATEWAY,
  PaymentGateway,
  PaymentGatewayError,
} from 'src/shared/payment-gateway/payment-gateway.interface';
import { GatewayCoupon } from 'src/shared/payment-gateway/payment-gateway.types';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { couponSituation } from './coupon-situation';
import {
  AdminCouponActionResultDto,
  AdminCouponDto,
  AdminCouponListResponseDto,
  AdminCouponRedemptionsResponseDto,
  CouponDuration,
  CouponPlanDto,
} from './dto/admin-coupons.dto';

export const COUPON_LIST_LIMIT = 100;
const REASON_MIN = 5;
const REASON_MAX = 500;
const DUPLICATE_CODE = 'COUPON_CODE_DUPLICATE';

export interface CreateCouponInput {
  code: string;
  percentOff?: number;
  amountOffCents?: number;
  duration: CouponDuration;
  durationInMonths?: number;
  maxRedemptions?: number;
  redeemBy?: string;
  planIds?: string[];
}

@Injectable()
export class AdminCouponsService {
  private readonly logger = new Logger(AdminCouponsService.name);

  constructor(
    private readonly audit: PlatformAuditService,
    private readonly planRepo: SubscriptionPlanRepository,
    private readonly invoiceRepo: GatewayInvoiceRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async list(now: Date = new Date()): Promise<AdminCouponListResponseDto> {
    const page = await this.callGateway(() =>
      this.gateway.listCoupons(COUPON_LIST_LIMIT),
    );
    const coupons = page.items;
    const plansByProduct = coupons.some((c) => c.appliesToProductIds.length)
      ? await this.plansByProduct()
      : new Map<string, CouponPlanDto[]>();
    return {
      items: coupons.map((coupon) => this.toDto(coupon, plansByProduct, now)),
      truncated: page.hasMore,
    };
  }

  async create(
    actorAdminId: string,
    input: CreateCouponInput,
    now: Date = new Date(),
  ): Promise<AdminCouponActionResultDto> {
    const redeemBy = input.redeemBy ? new Date(input.redeemBy) : undefined;
    if (redeemBy && redeemBy.getTime() <= now.getTime()) {
      throw new BadRequestException('redeemBy precisa estar no futuro.');
    }
    const priceIds = await this.resolvePriceIds(input.planIds);

    const log = await this.audit.begin({
      actorAdminId,
      action: PlatformAuditAction.COUPON_CREATED,
      before: null,
    });

    let created: GatewayCoupon;
    try {
      created = await this.gateway.createCoupon(
        {
          code: input.code,
          percentOff: input.percentOff,
          amountOffCents: input.amountOffCents,
          duration: input.duration,
          durationInMonths: input.durationInMonths,
          maxRedemptions: input.maxRedemptions,
          redeemBy,
          appliesToPriceIds: priceIds.length ? priceIds : undefined,
        },
        log.id,
      );
    } catch (err) {
      await this.recordFailure(log.id, err);
      throw this.mapError(err);
    }

    await this.recordSuccess(log.id, created.id, {
      code: created.code,
      percentOff: created.percentOff,
      amountOffCents: created.amountOffCents,
      duration: created.duration,
      durationInMonths: created.durationInMonths,
      maxRedemptions: created.maxRedemptions,
      expiresAt: created.expiresAt ? created.expiresAt.toISOString() : null,
      planIds: input.planIds ?? [],
      appliesToProductIds: created.appliesToProductIds,
      promotionCodeId: created.id,
      couponId: created.couponId,
    });

    const plansByProduct = created.appliesToProductIds.length
      ? await this.plansByProduct()
      : new Map<string, CouponPlanDto[]>();
    return {
      auditLogId: log.id,
      coupon: this.toDto(created, plansByProduct, now),
    };
  }

  async deactivate(
    promotionCodeId: string,
    actorAdminId: string,
    reasonInput: string,
    now: Date = new Date(),
  ): Promise<AdminCouponActionResultDto> {
    const reason = this.normalizeReason(reasonInput);
    const current = await this.callGateway(() =>
      this.gateway.getCoupon(promotionCodeId),
    );
    if (!current) throw new NotFoundException('Cupom não encontrado.');
    if (!current.active) {
      throw new ConflictException('O cupom já está desativado.');
    }

    const log = await this.audit.begin({
      actorAdminId,
      action: PlatformAuditAction.COUPON_DEACTIVATED,
      reason,
      before: { code: current.code, active: current.active },
    });

    try {
      await this.gateway.deactivateCoupon(promotionCodeId, log.id);
    } catch (err) {
      await this.recordFailure(log.id, err);
      throw this.mapError(err);
    }

    await this.recordSuccess(log.id, promotionCodeId, {
      code: current.code,
      active: false,
      reason,
    });

    const plansByProduct = current.appliesToProductIds.length
      ? await this.plansByProduct()
      : new Map<string, CouponPlanDto[]>();
    return {
      auditLogId: log.id,
      coupon: this.toDto({ ...current, active: false }, plansByProduct, now),
    };
  }

  async redemptions(
    promotionCodeId: string,
  ): Promise<AdminCouponRedemptionsResponseDto> {
    const coupon = await this.callGateway(() =>
      this.gateway.getCoupon(promotionCodeId),
    );
    if (!coupon) throw new NotFoundException('Cupom não encontrado.');
    const items = await this.invoiceRepo.listCouponRedemptions(coupon.code);
    return {
      code: coupon.code,
      timesRedeemed: coupon.timesRedeemed,
      items,
    };
  }

  private async resolvePriceIds(planIds: string[] | undefined) {
    if (!planIds?.length) return [];
    const plans = await this.planRepo.findByIds(planIds);
    const found = new Set(plans.map((p) => p.id));
    const missing = planIds.filter((id) => !found.has(id));
    if (missing.length) {
      throw new BadRequestException(
        `Plano(s) não encontrado(s): ${missing.join(', ')}.`,
      );
    }
    const withoutPrice = plans.filter((p) => !p.gatewayPriceId);
    if (withoutPrice.length) {
      throw new BadRequestException(
        `Plano(s) sem preço na Stripe: ${withoutPrice.map((p) => p.name).join(', ')}.`,
      );
    }
    return plans.map((p) => p.gatewayPriceId!);
  }

  private async plansByProduct(): Promise<Map<string, CouponPlanDto[]>> {
    const map = new Map<string, CouponPlanDto[]>();
    const plans = await this.planRepo.findWithGatewayPrice();
    await Promise.all(
      plans.map(async (plan) => {
        try {
          const price = await this.gateway.getPrice(plan.gatewayPriceId!);
          if (!price?.productId) return;
          const list = map.get(price.productId) ?? [];
          list.push({ id: plan.id, name: plan.name });
          map.set(price.productId, list);
        } catch (err) {
          this.logger.warn(
            `[admin-coupons] preço ${plan.gatewayPriceId} indisponível: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }),
    );
    return map;
  }

  private toDto(
    coupon: GatewayCoupon,
    plansByProduct: Map<string, CouponPlanDto[]>,
    now: Date,
  ): AdminCouponDto {
    const plans = new Map<string, CouponPlanDto>();
    for (const productId of coupon.appliesToProductIds) {
      for (const plan of plansByProduct.get(productId) ?? []) {
        plans.set(plan.id, plan);
      }
    }
    return {
      id: coupon.id,
      couponId: coupon.couponId,
      code: coupon.code,
      percentOff: coupon.percentOff,
      amountOffCents: coupon.amountOffCents,
      currency: coupon.currency,
      duration: coupon.duration,
      durationInMonths: coupon.durationInMonths,
      maxRedemptions: coupon.maxRedemptions,
      timesRedeemed: coupon.timesRedeemed,
      expiresAt: coupon.expiresAt,
      active: coupon.active,
      valid: coupon.valid,
      situation: couponSituation(coupon, now),
      restrictedToPlans: coupon.appliesToProductIds.length > 0,
      plans: [...plans.values()],
      createdAt: coupon.createdAt,
    };
  }

  private normalizeReason(reason: unknown): string {
    const value = typeof reason === 'string' ? reason.trim() : '';
    if (value.length < REASON_MIN || value.length > REASON_MAX) {
      throw new BadRequestException(
        `Motivo obrigatório, de ${REASON_MIN} a ${REASON_MAX} caracteres.`,
      );
    }
    return value;
  }

  private async callGateway<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      throw this.mapError(err);
    }
  }

  private mapError(err: unknown): unknown {
    return err instanceof PaymentGatewayError ? this.toException(err) : err;
  }

  private toException(err: PaymentGatewayError): Error {
    if (err.code === DUPLICATE_CODE || err.httpStatus === 409) {
      return new ConflictException(
        'Já existe um código promocional ativo com esse código na Stripe.',
      );
    }
    if (err.httpStatus === 404) {
      return new NotFoundException('Cupom não encontrado.');
    }
    if (err.httpStatus === 429 || err.httpStatus === undefined) {
      return new ServiceUnavailableException(
        'Stripe indisponível; nada foi alterado. Tente novamente.',
      );
    }
    if (err.httpStatus >= 400 && err.httpStatus < 500) {
      return new BadRequestException(`Stripe recusou o cupom: ${err.message}`);
    }
    return new BadGatewayException(
      'A Stripe falhou ao processar o cupom; nada foi alterado.',
    );
  }

  private async recordFailure(auditId: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await this.audit.fail(auditId, message.slice(0, 2000));
    } catch (auditErr) {
      this.logger.error(
        `[admin-coupons] falha ao marcar auditoria ${auditId} como failed: ${
          auditErr instanceof Error ? auditErr.message : String(auditErr)
        }`,
      );
    }
  }

  private async recordSuccess(
    auditId: string,
    gatewayRef: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.succeed(auditId, { after, gatewayRef });
    } catch (auditErr) {
      this.logger.error(
        `[admin-coupons] ação concluída mas a auditoria ${auditId} ficou pending: ${
          auditErr instanceof Error ? auditErr.message : String(auditErr)
        }`,
      );
    }
  }
}
