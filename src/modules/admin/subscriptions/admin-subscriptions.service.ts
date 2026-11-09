import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import {
  Subscription,
  SubscriptionStatus,
} from 'src/database/entities/subscription.entity';
import { SubscriptionPlanRepository } from 'src/database/repositories/subscription-plan.repository';
import { SubscriptionQuotaPeriodRepository } from 'src/database/repositories/subscription-quota-period.repository';
import { SubscriptionRepository } from 'src/database/repositories/subscription.repository';
import { MS_PER_DAY } from 'src/modules/billing/billing-days';
import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from 'src/shared/payment-gateway/payment-gateway.interface';
import { GatewaySubscription } from 'src/shared/payment-gateway/payment-gateway.types';
import { PlatformAuditService } from '../audit/platform-audit.service';
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
  AdminSubscriptionActionResultDto,
  EXTEND_TRIAL_MAX_DAYS,
  REVOKE_INTERNAL_TARGETS,
  REVOKE_TRIAL_DEFAULT_DAYS,
  RevokeInternalTarget,
} from './dto/admin-subscription-actions.dto';
import {
  ActionBlock,
  internalAccessBlock,
  lookupGatewaySubscriptions,
  trialExtensionDecision,
} from './subscription-admin-rules';

const MAX_TRIAL_AHEAD_DAYS = 730;
const SAO_PAULO_OFFSET = '-03:00';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

interface ExtendTrialInput {
  days?: number;
  until?: string;
  reason: string;
}

interface InternalAccessInput {
  reason: string;
}

interface RevokeInternalInput {
  to: RevokeInternalTarget;
  trialDays?: number;
  reason: string;
}

interface ActionContext {
  auditId: string | null;
  gatewayRef: string | null;
  failDetail: string | null;
}

interface ActionOutcome {
  changes: Partial<Subscription>;
  extra?: Record<string, unknown>;
}

@Injectable()
export class AdminSubscriptionsService {
  private readonly logger = new Logger(AdminSubscriptionsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly subscriptionRepo: SubscriptionRepository,
    private readonly planRepo: SubscriptionPlanRepository,
    private readonly quotaPeriodRepo: SubscriptionQuotaPeriodRepository,
    private readonly audit: PlatformAuditService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async extendTrial(
    ownerId: string,
    actorAdminId: string,
    input: ExtendTrialInput,
    now: Date = new Date(),
  ): Promise<AdminSubscriptionActionResultDto> {
    const reason = this.normalizeReason(input.reason);
    const request = this.parseExtension(input);

    return this.runAction(
      ownerId,
      actorAdminId,
      PlatformAuditAction.TRIAL_EXTENDED,
      reason,
      async (sub, manager, ctx) => {
        const remote = await this.lookupOrNull(sub, ctx);
        const decision = trialExtensionDecision(sub, remote);
        if (decision.block) throw this.toException(decision.block);

        const currentEnd =
          decision.gatewayTrial?.trialEndsAt ?? sub.trialEndsAt ?? null;
        const base =
          currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
        const target =
          request.days !== undefined
            ? new Date(base.getTime() + request.days * MS_PER_DAY)
            : request.until!;
        this.assertTrialEndBounds(target, base, now);
        const newEnd = this.truncateToSecond(target);

        const changes = { trialEndsAt: newEnd, currentPeriodEnd: newEnd };
        await this.subscriptionRepo.updateWithManager(sub.id, changes, manager);
        const quota = await this.extendOrOpenQuotaPeriod(
          sub,
          newEnd,
          now,
          manager,
        );

        if (decision.gatewayTrial) {
          const updated = await this.gateway.updateTrialEnd(
            decision.gatewayTrial.id,
            newEnd,
            ctx.auditId!,
          );
          ctx.gatewayRef = decision.gatewayTrial.id;
          const trialEndsAt = updated.trialEndsAt ?? newEnd;
          const periodEnd = updated.currentPeriodEnd ?? newEnd;
          if (
            trialEndsAt.getTime() !== newEnd.getTime() ||
            periodEnd.getTime() !== newEnd.getTime()
          ) {
            changes.trialEndsAt = trialEndsAt;
            changes.currentPeriodEnd = periodEnd;
            await this.subscriptionRepo.updateWithManager(
              sub.id,
              changes,
              manager,
            );
            if (periodEnd.getTime() > newEnd.getTime()) {
              await this.quotaPeriodRepo.extendPeriodEnd(
                quota.periodId as string,
                periodEnd,
                manager,
              );
              quota.periodEnd = periodEnd.toISOString();
            }
          }
        }

        return {
          changes,
          extra: {
            requested:
              request.days !== undefined
                ? { days: request.days }
                : { until: input.until },
            quota,
          },
        };
      },
    );
  }

  async grantInternalAccess(
    ownerId: string,
    actorAdminId: string,
    input: InternalAccessInput,
    now: Date = new Date(),
  ): Promise<AdminSubscriptionActionResultDto> {
    const reason = this.normalizeReason(input.reason);

    return this.runAction(
      ownerId,
      actorAdminId,
      PlatformAuditAction.INTERNAL_ACCESS_GRANTED,
      reason,
      async (sub, manager, ctx) => {
        const remote =
          sub.status === SubscriptionStatus.INTERNAL
            ? []
            : await this.lookupOrNull(sub, ctx);
        const block = internalAccessBlock(sub.status, remote);
        if (block) throw this.toException(block);

        const changes = {
          status: SubscriptionStatus.INTERNAL,
          internalAccessGrantedBy: actorAdminId,
          internalAccessGrantedAt: now,
          trialEndsAt: null,
          pastDueSince: null,
          suspendedAt: null,
          canceledAt: null,
          cancelAtPeriodEnd: false,
        };
        await this.subscriptionRepo.updateWithManager(sub.id, changes, manager);
        return { changes };
      },
    );
  }

  async revokeInternalAccess(
    ownerId: string,
    actorAdminId: string,
    input: RevokeInternalInput,
    now: Date = new Date(),
  ): Promise<AdminSubscriptionActionResultDto> {
    const reason = this.normalizeReason(input.reason);
    if (!REVOKE_INTERNAL_TARGETS.includes(input.to)) {
      throw new BadRequestException('Destino deve ser "trial" ou "canceled".');
    }
    const trialDays = input.trialDays ?? REVOKE_TRIAL_DEFAULT_DAYS;
    this.assertDays(trialDays, 'trialDays');

    return this.runAction(
      ownerId,
      actorAdminId,
      PlatformAuditAction.INTERNAL_ACCESS_REVOKED,
      reason,
      async (sub, manager) => {
        if (sub.status !== SubscriptionStatus.INTERNAL) {
          throw new ConflictException('A conta não tem acesso interno.');
        }

        if (input.to === 'canceled') {
          const changes = {
            status: SubscriptionStatus.CANCELED,
            canceledAt: now,
            cancelAtPeriodEnd: false,
            internalAccessGrantedBy: null,
            internalAccessGrantedAt: null,
          };
          await this.subscriptionRepo.updateWithManager(
            sub.id,
            changes,
            manager,
          );
          return { changes, extra: { to: input.to } };
        }

        const trialEnd = this.truncateToSecond(
          new Date(now.getTime() + trialDays * MS_PER_DAY),
        );
        const changes = {
          status: SubscriptionStatus.TRIALING,
          trialEndsAt: trialEnd,
          currentPeriodStart: now,
          currentPeriodEnd: trialEnd,
          canceledAt: null,
          cancelAtPeriodEnd: false,
          pastDueSince: null,
          suspendedAt: null,
          internalAccessGrantedBy: null,
          internalAccessGrantedAt: null,
        };
        await this.subscriptionRepo.updateWithManager(sub.id, changes, manager);
        await this.quotaPeriodRepo.closeCurrentPeriods(sub.id, now, manager);
        const quota = await this.openQuotaPeriod(sub, now, trialEnd, manager);
        return { changes, extra: { to: input.to, trialDays, quota } };
      },
    );
  }

  private async runAction(
    ownerId: string,
    actorAdminId: string,
    action: PlatformAuditAction,
    reason: string,
    body: (
      sub: Subscription,
      manager: EntityManager,
      ctx: ActionContext,
    ) => Promise<ActionOutcome>,
  ): Promise<AdminSubscriptionActionResultDto> {
    const ctx: ActionContext = {
      auditId: null,
      gatewayRef: null,
      failDetail: null,
    };

    let result: { sub: Subscription; outcome: ActionOutcome };
    try {
      result = await this.dataSource.transaction(async (manager) => {
        const sub = await this.subscriptionRepo.lockByOwnerId(ownerId, manager);
        if (!sub) throw new NotFoundException('Conta não encontrada');

        const log = await this.audit.begin({
          actorAdminId,
          action,
          targetOwnerId: ownerId,
          reason,
          before: this.snapshotOf(sub),
        });
        ctx.auditId = log.id;

        const outcome = await body(sub, manager, ctx);
        return { sub, outcome };
      });
    } catch (err) {
      if (ctx.auditId) {
        await this.recordFailure(ctx, err);
      }
      throw err;
    }

    const after = { ...result.sub, ...result.outcome.changes };
    await this.recordSuccess(ctx, {
      ...this.snapshotOf(after),
      ...(result.outcome.extra ?? {}),
    });

    return {
      auditLogId: ctx.auditId!,
      status: after.status,
      trialEndsAt: after.trialEndsAt ?? null,
      currentPeriodEnd: after.currentPeriodEnd,
      gatewayRef: ctx.gatewayRef,
    };
  }

  private async recordFailure(ctx: ActionContext, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const detail = ctx.failDetail ? `${message} (${ctx.failDetail})` : message;
    try {
      await this.audit.fail(
        ctx.auditId!,
        detail.slice(0, 2000),
        ctx.gatewayRef,
      );
    } catch (auditErr) {
      this.logger.error(
        `[admin-subscriptions] falha ao marcar auditoria ${ctx.auditId} como failed: ${
          auditErr instanceof Error ? auditErr.message : String(auditErr)
        }`,
      );
    }
  }

  private async recordSuccess(
    ctx: ActionContext,
    after: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.succeed(ctx.auditId!, {
        after,
        gatewayRef: ctx.gatewayRef,
      });
    } catch (auditErr) {
      this.logger.error(
        `[admin-subscriptions] ação concluída mas a auditoria ${ctx.auditId} ficou pending: ${
          auditErr instanceof Error ? auditErr.message : String(auditErr)
        }`,
      );
    }
  }

  private async lookupOrNull(
    sub: Subscription,
    ctx: ActionContext,
  ): Promise<GatewaySubscription[] | null> {
    try {
      return await lookupGatewaySubscriptions(this.gateway, sub);
    } catch (err) {
      ctx.failDetail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[admin-subscriptions] consulta à Stripe falhou para subscription=${sub.id}: ${ctx.failDetail}`,
      );
      return null;
    }
  }

  private toException(block: ActionBlock): Error {
    return block.kind === 'gateway_unavailable'
      ? new ServiceUnavailableException(block.message)
      : new ConflictException(block.message);
  }

  private async extendOrOpenQuotaPeriod(
    sub: Subscription,
    periodEnd: Date,
    now: Date,
    manager: EntityManager,
  ): Promise<Record<string, unknown>> {
    const current = await this.quotaPeriodRepo.findCurrentForSubscription(
      sub.id,
      now,
      manager,
    );
    if (current) {
      const end =
        current.periodEnd.getTime() > periodEnd.getTime()
          ? current.periodEnd
          : periodEnd;
      await this.quotaPeriodRepo.extendPeriodEnd(current.id, end, manager);
      return { periodId: current.id, periodEnd: end.toISOString() };
    }
    return this.openQuotaPeriod(sub, now, periodEnd, manager);
  }

  private async openQuotaPeriod(
    sub: Subscription,
    periodStart: Date,
    periodEnd: Date,
    manager: EntityManager,
  ): Promise<Record<string, unknown>> {
    const plan = await this.planRepo.findOne({ id: sub.planId });
    if (!plan)
      throw new NotFoundException('Plano da assinatura não encontrado');
    const created = await this.quotaPeriodRepo.insertWithManager(
      {
        subscriptionId: sub.id,
        periodStart,
        periodEnd,
        surgeryRequestsLimit: plan.surgeryRequestQuota,
        surgeryRequestsUsed: 0,
      },
      manager,
    );
    return {
      periodId: created.id,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      created: true,
      limit: plan.surgeryRequestQuota,
    };
  }

  private normalizeReason(reason: unknown): string {
    const value = typeof reason === 'string' ? reason.trim() : '';
    if (value.length < ADMIN_REASON_MIN || value.length > ADMIN_REASON_MAX) {
      throw new BadRequestException(
        `Motivo obrigatório, de ${ADMIN_REASON_MIN} a ${ADMIN_REASON_MAX} caracteres.`,
      );
    }
    return value;
  }

  private parseExtension(input: ExtendTrialInput): {
    days?: number;
    until?: Date;
  } {
    const hasDays = input.days !== undefined && input.days !== null;
    const hasUntil = input.until !== undefined && input.until !== null;
    if (hasDays === hasUntil) {
      throw new BadRequestException('Informe exatamente um: days ou until.');
    }
    if (hasDays) {
      this.assertDays(input.days!, 'days');
      return { days: input.days };
    }
    const raw = String(input.until);
    const until = new Date(
      DATE_ONLY.test(raw) ? `${raw}T23:59:59${SAO_PAULO_OFFSET}` : raw,
    );
    if (Number.isNaN(until.getTime())) {
      throw new BadRequestException('until precisa ser uma data ISO 8601.');
    }
    return { until };
  }

  private assertDays(days: number, field: string): void {
    if (!Number.isInteger(days) || days < 1 || days > EXTEND_TRIAL_MAX_DAYS) {
      throw new BadRequestException(
        `${field} precisa ser um inteiro de 1 a ${EXTEND_TRIAL_MAX_DAYS}.`,
      );
    }
  }

  private assertTrialEndBounds(target: Date, base: Date, now: Date): void {
    if (target.getTime() <= base.getTime()) {
      throw new BadRequestException(
        'O novo término precisa ser posterior ao término atual do trial.',
      );
    }
    if (target.getTime() < now.getTime() + MS_PER_DAY) {
      throw new BadRequestException(
        'O novo término precisa ser a partir de amanhã.',
      );
    }
    if (target.getTime() > now.getTime() + MAX_TRIAL_AHEAD_DAYS * MS_PER_DAY) {
      throw new BadRequestException(
        `O novo término pode ser no máximo ${MAX_TRIAL_AHEAD_DAYS} dias a partir de hoje.`,
      );
    }
  }

  private truncateToSecond(date: Date): Date {
    return new Date(Math.floor(date.getTime() / 1000) * 1000);
  }

  private snapshotOf(sub: Subscription): Record<string, unknown> {
    const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
    return {
      status: sub.status,
      planId: sub.planId,
      trialEndsAt: iso(sub.trialEndsAt),
      currentPeriodStart: iso(sub.currentPeriodStart),
      currentPeriodEnd: iso(sub.currentPeriodEnd),
      pastDueSince: iso(sub.pastDueSince),
      suspendedAt: iso(sub.suspendedAt),
      canceledAt: iso(sub.canceledAt),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      gatewaySubscriptionId: sub.gatewaySubscriptionId,
      internalAccessGrantedBy: sub.internalAccessGrantedBy ?? null,
      internalAccessGrantedAt: iso(sub.internalAccessGrantedAt),
    };
  }
}
