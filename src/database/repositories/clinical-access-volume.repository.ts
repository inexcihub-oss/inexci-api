import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ClinicalAccessAudit } from '../entities/clinical-access-audit.entity';
import { User } from '../entities/user.entity';
import { BaseRepository } from './base.repository';

export interface ClinicalAccessVolumeFilter {
  ownerId: string;
  from: Date;
  to: Date;
}

export interface ClinicalAccessTotals {
  total: number;
  users: number;
}

export interface ClinicalAccessByActionRow {
  resource: string;
  action: string;
  origin: string;
  total: number;
}

export interface ClinicalAccessByUserRow {
  userId: string | null;
  userName: string | null;
  resource: string;
  action: string;
  total: number;
  lastAccessAt: Date;
}

export interface ClinicalAccessByPatientRow {
  patientRef: string;
  total: number;
  users: number;
  lastAccessAt: Date;
}

export interface ClinicalAccessEventRow {
  userId: string | null;
  userName: string | null;
  resource: string;
  action: string;
  origin: string;
  createdAt: Date;
}

export const PATIENT_REF_SQL = 'left(md5(a.patient_id::text), 10)';

export interface ClinicalAccessDayRow {
  day: string;
  total: number;
}

@Injectable()
export class ClinicalAccessVolumeRepository extends BaseRepository<ClinicalAccessAudit> {
  constructor(
    @InjectRepository(ClinicalAccessAudit)
    repository: Repository<ClinicalAccessAudit>,
  ) {
    super(repository);
  }

  private scoped(
    filter: ClinicalAccessVolumeFilter,
  ): SelectQueryBuilder<ClinicalAccessAudit> {
    return this.repository
      .createQueryBuilder('a')
      .where('a.owner_id = :ownerId', { ownerId: filter.ownerId })
      .andWhere('a.created_at >= :from AND a.created_at < :to', {
        from: filter.from,
        to: filter.to,
      });
  }

  async totals(
    filter: ClinicalAccessVolumeFilter,
  ): Promise<ClinicalAccessTotals> {
    const row = await this.scoped(filter)
      .select('COUNT(*)::int', 'total')
      .addSelect('COUNT(DISTINCT a.actor_user_id)::int', 'users')
      .getRawOne<ClinicalAccessTotals>();
    return {
      total: Number(row?.total ?? 0),
      users: Number(row?.users ?? 0),
    };
  }

  async byAction(
    filter: ClinicalAccessVolumeFilter,
  ): Promise<ClinicalAccessByActionRow[]> {
    const rows = await this.scoped(filter)
      .select('a.resource', 'resource')
      .addSelect('a.action', 'action')
      .addSelect('a.origin', 'origin')
      .addSelect('COUNT(*)::int', 'total')
      .groupBy('a.resource')
      .addGroupBy('a.action')
      .addGroupBy('a.origin')
      .orderBy('"total"', 'DESC')
      .getRawMany<ClinicalAccessByActionRow>();
    return rows.map((r) => ({ ...r, total: Number(r.total) }));
  }

  async byUser(
    filter: ClinicalAccessVolumeFilter,
  ): Promise<ClinicalAccessByUserRow[]> {
    const rows = await this.scoped(filter)
      .leftJoin(User, 'u', 'u.id = a.actor_user_id')
      .select('a.actor_user_id', 'userId')
      .addSelect('u.name', 'userName')
      .addSelect('a.resource', 'resource')
      .addSelect('a.action', 'action')
      .addSelect('COUNT(*)::int', 'total')
      .addSelect('MAX(a.created_at)', 'lastAccessAt')
      .groupBy('a.actor_user_id')
      .addGroupBy('u.name')
      .addGroupBy('a.resource')
      .addGroupBy('a.action')
      .orderBy('u.name', 'ASC', 'NULLS LAST')
      .addOrderBy('"total"', 'DESC')
      .getRawMany<ClinicalAccessByUserRow>();
    return rows.map((r) => ({ ...r, total: Number(r.total) }));
  }

  async daily(
    filter: ClinicalAccessVolumeFilter,
  ): Promise<ClinicalAccessDayRow[]> {
    const rows = await this.scoped(filter)
      .select(
        `to_char((a.created_at AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD')`,
        'day',
      )
      .addSelect('COUNT(*)::int', 'total')
      .groupBy('"day"')
      .orderBy('"day"', 'ASC')
      .getRawMany<ClinicalAccessDayRow>();
    return rows.map((r) => ({ ...r, total: Number(r.total) }));
  }

  async byPatient(
    filter: ClinicalAccessVolumeFilter,
    limit: number,
  ): Promise<ClinicalAccessByPatientRow[]> {
    const rows = await this.scoped(filter)
      .andWhere('a.patient_id IS NOT NULL')
      .select(PATIENT_REF_SQL, 'patientRef')
      .addSelect('COUNT(*)::int', 'total')
      .addSelect('COUNT(DISTINCT a.actor_user_id)::int', 'users')
      .addSelect('MAX(a.created_at)', 'lastAccessAt')
      .groupBy('"patientRef"')
      .orderBy('"total"', 'DESC')
      .addOrderBy('"lastAccessAt"', 'DESC')
      .limit(limit)
      .getRawMany<ClinicalAccessByPatientRow>();
    return rows.map((r) => ({
      ...r,
      total: Number(r.total),
      users: Number(r.users),
    }));
  }

  async patientEvents(
    filter: ClinicalAccessVolumeFilter,
    patientRef: string,
    limit: number,
  ): Promise<ClinicalAccessEventRow[]> {
    return this.scoped(filter)
      .andWhere('a.patient_id IS NOT NULL')
      .andWhere(`${PATIENT_REF_SQL} = :patientRef`, { patientRef })
      .leftJoin(User, 'u', 'u.id = a.actor_user_id')
      .select('a.actor_user_id', 'userId')
      .addSelect('u.name', 'userName')
      .addSelect('a.resource', 'resource')
      .addSelect('a.action', 'action')
      .addSelect('a.origin', 'origin')
      .addSelect('a.created_at', 'createdAt')
      .orderBy('a.created_at', 'DESC')
      .limit(limit)
      .getRawMany<ClinicalAccessEventRow>();
  }
}
