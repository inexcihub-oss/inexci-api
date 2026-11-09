import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  GatewayInvoice,
  GatewayInvoiceStatus,
} from '../entities/gateway-invoice.entity';
import {
  Subscription,
  SubscriptionStatus,
} from '../entities/subscription.entity';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { BaseRepository } from './base.repository';

export interface AdminInvoicesFilter {
  status?: GatewayInvoiceStatus;
  ownerId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface AdminInvoiceRow {
  invoice: GatewayInvoice;
  ownerName: string | null;
  ownerEmail: string | null;
}

export interface AdminOpenTotals {
  amountCents: number;
  invoices: number;
}

const NOT_INTERNAL_OWNER_SQL =
  "NOT EXISTS (SELECT 1 FROM subscriptions xs WHERE xs.owner_id = gi.owner_id AND xs.status = 'internal')";
const TIME_ZONE = 'America/Sao_Paulo';

const toInt = (value: unknown): number => Number(value ?? 0) || 0;

@Injectable()
export class AdminRevenueRepository extends BaseRepository<GatewayInvoice> {
  constructor(
    @InjectRepository(GatewayInvoice) repo: Repository<GatewayInvoice>,
  ) {
    super(repo);
  }

  private paidBetween(
    from: Date,
    to: Date,
  ): SelectQueryBuilder<GatewayInvoice> {
    return this.repository
      .createQueryBuilder('gi')
      .where('gi.status = :paid', { paid: 'paid' })
      .andWhere('gi.paidAt >= :from', { from })
      .andWhere('gi.paidAt < :to', { to })
      .andWhere(NOT_INTERNAL_OWNER_SQL);
  }

  async sumPaidBetween(
    from: Date,
    to: Date,
  ): Promise<{
    receivedCents: number;
    discountCents: number;
    invoices: number;
  }> {
    const raw = await this.paidBetween(from, to)
      .select('SUM(gi.amountPaidCents)', 'received')
      .addSelect('SUM(gi.amountDiscountCents)', 'discount')
      .addSelect('COUNT(*)', 'invoices')
      .getRawOne<{
        received: string | null;
        discount: string | null;
        invoices: string;
      }>();
    return {
      receivedCents: toInt(raw?.received),
      discountCents: toInt(raw?.discount),
      invoices: toInt(raw?.invoices),
    };
  }

  async receivedByMonth(
    from: Date,
    to: Date,
  ): Promise<Array<{ month: string; receivedCents: number }>> {
    const monthExpr = `to_char(gi.paidAt AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM')`;
    const rows = await this.paidBetween(from, to)
      .select(monthExpr, 'month')
      .addSelect('SUM(gi.amountPaidCents)', 'received')
      .groupBy(monthExpr)
      .orderBy('month', 'ASC')
      .getRawMany<{ month: string; received: string }>();
    return rows.map((r) => ({
      month: r.month,
      receivedCents: toInt(r.received),
    }));
  }

  private openInvoices(): SelectQueryBuilder<GatewayInvoice> {
    return this.repository
      .createQueryBuilder('gi')
      .where('gi.status = :open', { open: 'open' })
      .andWhere(NOT_INTERNAL_OWNER_SQL);
  }

  async openTotals(): Promise<AdminOpenTotals> {
    const raw = await this.openInvoices()
      .select('SUM(gi.amountDueCents - gi.amountPaidCents)', 'amount')
      .addSelect('COUNT(*)', 'invoices')
      .getRawOne<{ amount: string | null; invoices: string }>();
    return { amountCents: toInt(raw?.amount), invoices: toInt(raw?.invoices) };
  }

  async outstandingByOwner(
    ownerIds: string[],
  ): Promise<Map<string, AdminOpenTotals>> {
    const result = new Map<string, AdminOpenTotals>();
    if (!ownerIds.length) return result;
    const rows = await this.repository
      .createQueryBuilder('gi')
      .where('gi.status IN (:...outstanding)', {
        outstanding: ['open', 'uncollectible'],
      })
      .andWhere('gi.ownerId IN (:...ownerIds)', { ownerIds })
      .select('gi.ownerId', 'ownerId')
      .addSelect('SUM(gi.amountDueCents - gi.amountPaidCents)', 'amount')
      .addSelect('COUNT(*)', 'invoices')
      .groupBy('gi.ownerId')
      .getRawMany<{ ownerId: string; amount: string; invoices: string }>();
    for (const r of rows) {
      result.set(r.ownerId, {
        amountCents: toInt(r.amount),
        invoices: toInt(r.invoices),
      });
    }
    return result;
  }

  async findInvoices(
    filter: AdminInvoicesFilter,
  ): Promise<{ items: AdminInvoiceRow[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('gi')
      .leftJoin('gi.owner', 'o')
      .select(['gi', 'o.id', 'o.name', 'o.email']);
    if (filter.status) {
      qb.andWhere('gi.status = :status', { status: filter.status });
    }
    if (filter.ownerId) {
      qb.andWhere('gi.ownerId = :ownerId', { ownerId: filter.ownerId });
    }
    if (filter.from) {
      qb.andWhere('gi.invoiceCreatedAt >= :from', { from: filter.from });
    }
    if (filter.to) {
      qb.andWhere('gi.invoiceCreatedAt < :to', { to: filter.to });
    }
    const [invoices, total] = await qb
      .orderBy('gi.invoiceCreatedAt', 'DESC')
      .addOrderBy('gi.id', 'DESC')
      .skip(filter.offset)
      .take(filter.limit)
      .getManyAndCount();
    return {
      total,
      items: invoices.map((invoice) => ({
        invoice,
        ownerName: invoice.owner?.name ?? null,
        ownerEmail: invoice.owner?.email ?? null,
      })),
    };
  }

  private clientSubscriptions(): SelectQueryBuilder<Subscription> {
    return this.repository.manager
      .getRepository(Subscription)
      .createQueryBuilder('s')
      .innerJoin('s.owner', 'o')
      .innerJoin('s.plan', 'p')
      .select(['s', 'o.id', 'o.name', 'o.email', 'p'])
      .where('o.ownerId = o.id');
  }

  findRevenueSubscriptions(): Promise<Subscription[]> {
    return this.clientSubscriptions()
      .andWhere('s.status IN (:...revenueStatuses)', {
        revenueStatuses: [
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.PAST_DUE,
        ],
      })
      .andWhere('s.gatewaySubscriptionId IS NOT NULL')
      .orderBy('s.createdAt', 'ASC')
      .getMany();
  }

  findDelinquentSubscriptions(): Promise<Subscription[]> {
    return this.clientSubscriptions()
      .andWhere('s.status IN (:...delinquentStatuses)', {
        delinquentStatuses: [
          SubscriptionStatus.PAST_DUE,
          SubscriptionStatus.SUSPENDED,
        ],
      })
      .orderBy('s.pastDueSince', 'ASC', 'NULLS LAST')
      .addOrderBy('s.createdAt', 'ASC')
      .getMany();
  }

  async findPlansWithAccountCounts(): Promise<{
    plans: SubscriptionPlan[];
    counts: Map<string, number>;
  }> {
    const plans = await this.repository.manager
      .getRepository(SubscriptionPlan)
      .createQueryBuilder('p')
      .orderBy('p.sortOrder', 'ASC')
      .addOrderBy('p.name', 'ASC')
      .getMany();
    const rows = await this.repository.manager
      .getRepository(Subscription)
      .createQueryBuilder('s')
      .select('s.planId', 'planId')
      .addSelect('COUNT(*)', 'count')
      .where('s.status NOT IN (:...excluded)', {
        excluded: [SubscriptionStatus.CANCELED, SubscriptionStatus.INTERNAL],
      })
      .groupBy('s.planId')
      .getRawMany<{ planId: string; count: string }>();
    return {
      plans,
      counts: new Map(rows.map((r) => [r.planId, toInt(r.count)])),
    };
  }
}
