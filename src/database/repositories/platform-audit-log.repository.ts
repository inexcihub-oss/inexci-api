import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  PlatformAuditAction,
  PlatformAuditLog,
  PlatformAuditStatus,
} from '../entities/platform-audit-log.entity';
import { BaseRepository } from './base.repository';

export interface PlatformAuditLogFilter {
  targetOwnerId?: string;
  actorAdminId?: string;
  action?: PlatformAuditAction;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface PlatformAuditLastRun {
  at: Date;
  by: string | null;
  result: Record<string, unknown> | null;
}

export interface PlatformAuditLogRow {
  id: string;
  actorUserId: string;
  actorName: string | null;
  actorEmail: string | null;
  action: PlatformAuditAction;
  targetOwnerId: string | null;
  targetUserId: string | null;
  targetName: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  gatewayRef: string | null;
  status: PlatformAuditStatus;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

@Injectable()
export class PlatformAuditLogRepository extends BaseRepository<PlatformAuditLog> {
  constructor(
    @InjectRepository(PlatformAuditLog)
    repository: Repository<PlatformAuditLog>,
  ) {
    super(repository);
  }

  async markSucceeded(
    id: string,
    data: {
      after: Record<string, unknown> | null;
      gatewayRef: string | null;
      targetAdminId?: string;
    },
  ): Promise<void> {
    const values: QueryDeepPartialEntity<PlatformAuditLog> = {
      status: PlatformAuditStatus.SUCCEEDED,
      after: data.after as QueryDeepPartialEntity<PlatformAuditLog>['after'],
      gatewayRef: data.gatewayRef,
      completedAt: new Date(),
      ...(data.targetAdminId ? { targetAdminId: data.targetAdminId } : {}),
    };
    await this.repository.update(id, values);
  }

  async markFailed(
    id: string,
    error: string,
    gatewayRef: string | null = null,
  ): Promise<void> {
    await this.repository.update(id, {
      status: PlatformAuditStatus.FAILED,
      error,
      gatewayRef,
      completedAt: new Date(),
    });
  }

  async search(
    filter: PlatformAuditLogFilter,
  ): Promise<{ items: PlatformAuditLogRow[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('l')
      .leftJoin('l.actor', 'a')
      .leftJoin('l.targetAdmin', 't')
      .select([
        'l.id',
        'l.actorAdminId',
        'l.action',
        'l.targetOwnerId',
        'l.targetUserId',
        'l.targetAdminId',
        'l.reason',
        'l.before',
        'l.after',
        'l.gatewayRef',
        'l.status',
        'l.error',
        'l.createdAt',
        'l.completedAt',
        'a.id',
        'a.name',
        'a.email',
        't.id',
        't.name',
      ]);

    if (filter.targetOwnerId) {
      qb.andWhere('l.target_owner_id = :targetOwnerId', {
        targetOwnerId: filter.targetOwnerId,
      });
    }
    if (filter.actorAdminId) {
      qb.andWhere('l.actor_admin_id = :actorAdminId', {
        actorAdminId: filter.actorAdminId,
      });
    }
    if (filter.action) {
      qb.andWhere('l.action = :action', { action: filter.action });
    }
    if (filter.from) {
      qb.andWhere('l.created_at >= :from', { from: filter.from });
    }
    if (filter.to) {
      qb.andWhere('l.created_at <= :to', { to: filter.to });
    }

    const [rows, total] = await qb
      .orderBy('l.createdAt', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .skip(filter.offset)
      .take(filter.limit)
      .getManyAndCount();

    const items = rows.map((row) => ({
      id: row.id,
      actorUserId: row.actorAdminId,
      actorName: row.actor?.name ?? null,
      actorEmail: row.actor?.email ?? null,
      action: row.action,
      targetOwnerId: row.targetOwnerId,
      targetUserId: row.targetUserId ?? row.targetAdminId,
      targetName: row.targetAdmin?.name ?? null,
      reason: row.reason,
      before: row.before,
      after: row.after,
      gatewayRef: row.gatewayRef,
      status: row.status,
      error: row.error,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    }));

    return { items, total };
  }

  async findLastSucceededByAction(
    actions: PlatformAuditAction[],
  ): Promise<Map<PlatformAuditAction, PlatformAuditLastRun>> {
    const resultado = new Map<PlatformAuditAction, PlatformAuditLastRun>();
    if (actions.length === 0) return resultado;
    const rows = await this.repository
      .createQueryBuilder('l')
      .leftJoin('l.actor', 'a')
      .select('l.action', 'action')
      .addSelect('l.completedAt', 'at')
      .addSelect('l.after', 'after')
      .addSelect('a.name', 'by')
      .distinctOn(['l.action'])
      .where('l.action IN (:...actions)', { actions })
      .andWhere('l.status = :status', {
        status: PlatformAuditStatus.SUCCEEDED,
      })
      .orderBy('l.action', 'ASC')
      .addOrderBy('l.createdAt', 'DESC')
      .getRawMany<{
        action: PlatformAuditAction;
        at: Date;
        after: Record<string, unknown> | null;
        by: string | null;
      }>();
    for (const row of rows) {
      resultado.set(row.action, {
        at: row.at,
        by: row.by ?? null,
        result: row.after ?? null,
      });
    }
    return resultado;
  }
}
