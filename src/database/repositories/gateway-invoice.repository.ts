import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  GatewayInvoice,
  GatewayInvoiceStatus,
} from '../entities/gateway-invoice.entity';
import { BaseRepository } from './base.repository';

export interface GatewayInvoiceMirrorRow {
  gatewayProvider: string;
  gatewayInvoiceId: string;
  ownerId: string | null;
  subscriptionId: string | null;
  gatewayCustomerId: string | null;
  gatewaySubscriptionId: string | null;
  status: GatewayInvoiceStatus;
  amountDueCents: number;
  amountPaidCents: number;
  amountDiscountCents: number;
  currency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  dueDate: Date | null;
  paidAt: Date | null;
  invoiceCreatedAt: Date;
  hostedInvoiceUrl: string | null;
  couponCode: string | null;
}

export interface CouponRedemptionRow {
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  firstInvoiceAt: Date;
  firstInvoiceId: string;
  invoicesCount: number;
  totalDiscountCents: number;
  currentDiscountPercentOff: number | null;
  currentDiscountAmountOffCents: number | null;
  currentDiscountDuration: string | null;
  currentDiscountEndsAt: Date | null;
}

const COUPON_REDEMPTIONS_SQL = `WITH usadas AS (
  SELECT gi.owner_id, gi.gateway_invoice_id, gi.invoice_created_at, gi.amount_discount_cents,
    ROW_NUMBER() OVER (PARTITION BY gi.owner_id ORDER BY gi.invoice_created_at ASC, gi.gateway_invoice_id ASC) AS pos
  FROM gateway_invoices gi
  WHERE gi.owner_id IS NOT NULL AND lower(gi.coupon_code) = lower($1)
)
SELECT u.owner_id AS "ownerId", usr.name AS "ownerName", usr.email AS "ownerEmail",
  MIN(u.invoice_created_at) AS "firstInvoiceAt",
  MAX(CASE WHEN u.pos = 1 THEN u.gateway_invoice_id END) AS "firstInvoiceId",
  COUNT(*)::int AS "invoicesCount",
  COALESCE(SUM(u.amount_discount_cents), 0)::int AS "totalDiscountCents",
  sub.discount_percent_off AS "currentDiscountPercentOff",
  sub.discount_amount_off_cents AS "currentDiscountAmountOffCents",
  sub.discount_duration AS "currentDiscountDuration",
  sub.discount_ends_at AS "currentDiscountEndsAt"
FROM usadas u
JOIN users usr ON usr.id = u.owner_id
LEFT JOIN LATERAL (
  SELECT s.discount_percent_off, s.discount_amount_off_cents, s.discount_duration, s.discount_ends_at
  FROM subscriptions s WHERE s.owner_id = u.owner_id ORDER BY s.created_at DESC LIMIT 1
) sub ON TRUE
GROUP BY u.owner_id, usr.name, usr.email, sub.discount_percent_off,
  sub.discount_amount_off_cents, sub.discount_duration, sub.discount_ends_at
ORDER BY MIN(u.invoice_created_at) DESC`;

const statusRank = (ref: string): string =>
  `(CASE ${ref} WHEN 'draft' THEN 0 WHEN 'open' THEN 1 WHEN 'uncollectible' THEN 2 WHEN 'paid' THEN 3 WHEN 'void' THEN 3 ELSE 0 END)`;

const keep = (column: string): string =>
  `"${column}" = COALESCE(EXCLUDED."${column}", "gateway_invoices"."${column}")`;

const overwrite = (column: string): string =>
  `"${column}" = EXCLUDED."${column}"`;

const UPSERT_SQL = `INSERT INTO "gateway_invoices" (
  "gateway_provider", "gateway_invoice_id", "owner_id", "subscription_id",
  "gateway_customer_id", "gateway_subscription_id", "status",
  "amount_due_cents", "amount_paid_cents", "amount_discount_cents", "currency",
  "period_start", "period_end", "due_date", "paid_at", "invoice_created_at",
  "hosted_invoice_url", "coupon_code"
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
ON CONFLICT ("gateway_invoice_id") DO UPDATE SET
  ${[
    keep('owner_id'),
    keep('subscription_id'),
    keep('gateway_customer_id'),
    keep('gateway_subscription_id'),
    overwrite('status'),
    overwrite('amount_due_cents'),
    overwrite('amount_paid_cents'),
    overwrite('amount_discount_cents'),
    overwrite('currency'),
    keep('period_start'),
    keep('period_end'),
    keep('due_date'),
    keep('paid_at'),
    overwrite('invoice_created_at'),
    keep('hosted_invoice_url'),
    keep('coupon_code'),
    '"updated_at" = now()',
  ].join(',\n  ')}
WHERE ${statusRank('"gateway_invoices"."status"')} <= ${statusRank('EXCLUDED."status"')}`;

@Injectable()
export class GatewayInvoiceRepository extends BaseRepository<GatewayInvoice> {
  constructor(
    @InjectRepository(GatewayInvoice) repo: Repository<GatewayInvoice>,
  ) {
    super(repo);
  }

  async upsertMirror(row: GatewayInvoiceMirrorRow): Promise<void> {
    await this.repository.query(UPSERT_SQL, [
      row.gatewayProvider,
      row.gatewayInvoiceId,
      row.ownerId,
      row.subscriptionId,
      row.gatewayCustomerId,
      row.gatewaySubscriptionId,
      row.status,
      row.amountDueCents,
      row.amountPaidCents,
      row.amountDiscountCents,
      row.currency,
      row.periodStart,
      row.periodEnd,
      row.dueDate,
      row.paidAt,
      row.invoiceCreatedAt,
      row.hostedInvoiceUrl,
      row.couponCode,
    ]);
  }

  async listCouponRedemptions(code: string): Promise<CouponRedemptionRow[]> {
    const rows: Array<
      Omit<CouponRedemptionRow, 'currentDiscountPercentOff'> & {
        currentDiscountPercentOff: string | number | null;
      }
    > = await this.repository.query(COUPON_REDEMPTIONS_SQL, [code]);
    return rows.map((row) => ({
      ...row,
      currentDiscountPercentOff:
        row.currentDiscountPercentOff === null
          ? null
          : Number(row.currentDiscountPercentOff),
    }));
  }
}
