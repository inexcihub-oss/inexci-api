import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentGatewayEvent } from '../entities/payment-gateway-event.entity';
import { BaseRepository } from './base.repository';

export type GatewayEventSituation = 'processed' | 'pending' | 'failed';

export interface AdminGatewayEventFilter {
  ownerId?: string;
  onlyProblems?: boolean;
  staleBefore: Date;
  limit: number;
  offset: number;
}

export interface AdminGatewayEventRow {
  id: string;
  eventId: string;
  eventType: string;
  gatewayType: string | null;
  createdAt: Date;
  processedAt: Date | null;
  error: string | null;
  customerId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  payload: unknown;
}

export interface AdminGatewayEventCounts {
  failed: number;
  stalePending: number;
}

interface RawRow {
  id: string;
  eventId: string;
  eventType: string;
  gatewayType: string | null;
  createdAt: Date | string;
  processedAt: Date | string | null;
  error: string | null;
  customerId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  payload: unknown;
  total?: string | number;
}

const RESOLVED_EVENTS_SQL = `
  SELECT
    e.id,
    e.event_id AS "eventId",
    e.event_type AS "eventType",
    e.payload ->> 'type' AS "gatewayType",
    e.created_at AS "createdAt",
    e.processed_at AS "processedAt",
    e.error,
    e.payload,
    e.payload #>> '{data,object,customer}' AS "customerId",
    s.owner_id AS "ownerId",
    u.name AS "ownerName"
  FROM payment_gateway_events e
  LEFT JOIN LATERAL (
    SELECT sub.owner_id
    FROM subscriptions sub
    WHERE (
      e.payload #>> '{data,object,customer}' IS NOT NULL
      AND sub.gateway_customer_id = e.payload #>> '{data,object,customer}'
    ) OR (
      sub.gateway_subscription_id IS NOT NULL
      AND sub.gateway_subscription_id = COALESCE(
        CASE
          WHEN e.payload #>> '{data,object,object}' = 'subscription'
          THEN e.payload #>> '{data,object,id}'
        END,
        e.payload #>> '{data,object,subscription}',
        e.payload #>> '{data,object,parent,subscription_details,subscription}'
      )
    )
    ORDER BY sub.created_at DESC
    LIMIT 1
  ) s ON true
  LEFT JOIN users u ON u.id = s.owner_id
`;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toRow(raw: RawRow): AdminGatewayEventRow {
  return {
    id: raw.id,
    eventId: raw.eventId,
    eventType: raw.eventType,
    gatewayType: raw.gatewayType,
    createdAt: toDate(raw.createdAt),
    processedAt: raw.processedAt ? toDate(raw.processedAt) : null,
    error: raw.error,
    customerId: raw.customerId,
    ownerId: raw.ownerId,
    ownerName: raw.ownerName,
    payload: raw.payload,
  };
}

@Injectable()
export class AdminGatewayEventsRepository extends BaseRepository<PaymentGatewayEvent> {
  constructor(
    @InjectRepository(PaymentGatewayEvent)
    repo: Repository<PaymentGatewayEvent>,
  ) {
    super(repo);
  }

  async search(
    filter: AdminGatewayEventFilter,
  ): Promise<{ items: AdminGatewayEventRow[]; total: number }> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filter.onlyProblems) {
      params.push(filter.staleBefore);
      where.push(
        `r."processedAt" IS NULL AND (r.error IS NOT NULL OR r."createdAt" < $${params.length})`,
      );
    }
    if (filter.ownerId) {
      params.push(filter.ownerId);
      where.push(`r."ownerId" = $${params.length}`);
    }
    params.push(filter.limit);
    const limitIdx = params.length;
    params.push(filter.offset);
    const offsetIdx = params.length;
    const rows: RawRow[] = await this.repository.query(
      `SELECT r.*, COUNT(*) OVER () AS total
       FROM (${RESOLVED_EVENTS_SQL}) r
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY r."createdAt" DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    return {
      items: rows.map(toRow),
      total: rows.length ? Number(rows[0].total) : 0,
    };
  }

  async findResolved(id: string): Promise<AdminGatewayEventRow | null> {
    const rows: RawRow[] = await this.repository.query(
      `SELECT r.* FROM (${RESOLVED_EVENTS_SQL}) r WHERE r.id = $1`,
      [id],
    );
    return rows[0] ? toRow(rows[0]) : null;
  }

  async countProblems(staleBefore: Date): Promise<AdminGatewayEventCounts> {
    const rows: Array<{ failed: string; stalePending: string }> =
      await this.repository.query(
        `SELECT
           COUNT(*) FILTER (WHERE processed_at IS NULL AND error IS NOT NULL) AS failed,
           COUNT(*) FILTER (
             WHERE processed_at IS NULL AND error IS NULL AND created_at < $1
           ) AS "stalePending"
         FROM payment_gateway_events`,
        [staleBefore],
      );
    return {
      failed: Number(rows[0]?.failed ?? 0),
      stalePending: Number(rows[0]?.stalePending ?? 0),
    };
  }
}
