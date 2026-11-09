import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from '../entities/subscription.entity';
import { User } from '../entities/user.entity';
import { SurgeryRequest } from '../entities/surgery-request.entity';
import { Appointment, AppointmentStatus } from '../entities/appointment.entity';
import { Patient } from '../entities/patient.entity';
import { ClinicalRecord } from '../entities/clinical-record.entity';
import { CLIENT_OWNER_IDS_SQL, TIME_ZONE } from './admin-accounts.repository';
import { BaseRepository } from './base.repository';

export interface AdminUsageRange {
  from: Date;
  to: Date;
}

export interface AdminUsageWeekRow {
  weekStart: string;
  count: number;
}

export interface AdminUsageAppointmentWeekRow extends AdminUsageWeekRow {
  status: AppointmentStatus;
}

export interface AdminUsageRankingRow {
  ownerId: string;
  name: string;
  email: string;
  count: number;
}

function weekExpression(column: string): string {
  return `to_char(date_trunc('week', ${column} AT TIME ZONE '${TIME_ZONE}'), 'YYYY-MM-DD')`;
}

@Injectable()
export class AdminUsageRepository extends BaseRepository<Subscription> {
  constructor(@InjectRepository(Subscription) repo: Repository<Subscription>) {
    super(repo);
  }

  private get manager() {
    return this.repository.manager;
  }

  async weeklySurgeryRequestsCreated(
    range: AdminUsageRange,
  ): Promise<AdminUsageWeekRow[]> {
    return this.toWeekRows(
      await this.manager
        .createQueryBuilder(SurgeryRequest, 'sr')
        .select(weekExpression('sr.createdAt'), 'weekStart')
        .addSelect('COUNT(*)', 'count')
        .where(`sr.ownerId IN ${CLIENT_OWNER_IDS_SQL}`)
        .andWhere('sr.createdAt >= :from AND sr.createdAt < :to', range)
        .groupBy('"weekStart"')
        .getRawMany<{ weekStart: string; count: string }>(),
    );
  }

  async weeklySurgeryRequestsSent(
    range: AdminUsageRange,
  ): Promise<AdminUsageWeekRow[]> {
    return this.toWeekRows(
      await this.manager
        .createQueryBuilder(SurgeryRequest, 'sr')
        .select(weekExpression('sr.sentAt'), 'weekStart')
        .addSelect('COUNT(*)', 'count')
        .where(`sr.ownerId IN ${CLIENT_OWNER_IDS_SQL}`)
        .andWhere('sr.sentAt >= :from AND sr.sentAt < :to', range)
        .groupBy('"weekStart"')
        .getRawMany<{ weekStart: string; count: string }>(),
    );
  }

  async weeklyAppointmentsByStatus(
    range: AdminUsageRange,
  ): Promise<AdminUsageAppointmentWeekRow[]> {
    const raw = await this.manager
      .createQueryBuilder(Appointment, 'ap')
      .select(weekExpression('ap.scheduledAt'), 'weekStart')
      .addSelect('ap.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where(`ap.ownerId IN ${CLIENT_OWNER_IDS_SQL}`)
      .andWhere('ap.scheduledAt >= :from AND ap.scheduledAt < :to', range)
      .groupBy('"weekStart"')
      .addGroupBy('ap.status')
      .getRawMany<{
        weekStart: string;
        status: AppointmentStatus;
        count: string;
      }>();
    return raw.map((r) => ({
      weekStart: r.weekStart,
      status: r.status,
      count: Number(r.count),
    }));
  }

  async weeklyPatientsCreated(
    range: AdminUsageRange,
  ): Promise<AdminUsageWeekRow[]> {
    return this.toWeekRows(
      await this.manager
        .createQueryBuilder(Patient, 'pt')
        .select(weekExpression('pt.createdAt'), 'weekStart')
        .addSelect('COUNT(*)', 'count')
        .where(`pt.ownerId IN ${CLIENT_OWNER_IDS_SQL}`)
        .andWhere('pt.createdAt >= :from AND pt.createdAt < :to', range)
        .groupBy('"weekStart"')
        .getRawMany<{ weekStart: string; count: string }>(),
    );
  }

  async weeklyRecordsFinalized(
    range: AdminUsageRange,
  ): Promise<AdminUsageWeekRow[]> {
    return this.toWeekRows(
      await this.manager
        .createQueryBuilder(ClinicalRecord, 'cr')
        .select(weekExpression('cr.finalizedAt'), 'weekStart')
        .addSelect('COUNT(*)', 'count')
        .where(`cr.ownerId IN ${CLIENT_OWNER_IDS_SQL}`)
        .andWhere('cr.finalizedAt >= :from AND cr.finalizedAt < :to', range)
        .groupBy('"weekStart"')
        .getRawMany<{ weekStart: string; count: string }>(),
    );
  }

  async topBySurgeryRequests(
    range: AdminUsageRange,
    limit: number,
  ): Promise<AdminUsageRankingRow[]> {
    const raw = await this.manager
      .createQueryBuilder(SurgeryRequest, 'sr')
      .innerJoin(User, 'ow', 'ow.id = sr.ownerId')
      .select('ow.id', 'ownerId')
      .addSelect('ow.name', 'name')
      .addSelect('ow.email', 'email')
      .addSelect('COUNT(*)', 'count')
      .where(`sr.ownerId IN ${CLIENT_OWNER_IDS_SQL}`)
      .andWhere('sr.createdAt >= :from AND sr.createdAt < :to', range)
      .groupBy('ow.id')
      .addGroupBy('ow.name')
      .addGroupBy('ow.email')
      .orderBy('"count"', 'DESC')
      .addOrderBy('ow.name', 'ASC')
      .addOrderBy('ow.id', 'ASC')
      .limit(limit)
      .getRawMany<{
        ownerId: string;
        name: string;
        email: string;
        count: string;
      }>();
    return this.toRankingRows(raw);
  }

  async topByAppointments(
    range: AdminUsageRange,
    limit: number,
  ): Promise<AdminUsageRankingRow[]> {
    const raw = await this.manager
      .createQueryBuilder(Appointment, 'ap')
      .innerJoin(User, 'ow', 'ow.id = ap.ownerId')
      .select('ow.id', 'ownerId')
      .addSelect('ow.name', 'name')
      .addSelect('ow.email', 'email')
      .addSelect('COUNT(*)', 'count')
      .where(`ap.ownerId IN ${CLIENT_OWNER_IDS_SQL}`)
      .andWhere('ap.scheduledAt >= :from AND ap.scheduledAt < :to', range)
      .groupBy('ow.id')
      .addGroupBy('ow.name')
      .addGroupBy('ow.email')
      .orderBy('"count"', 'DESC')
      .addOrderBy('ow.name', 'ASC')
      .addOrderBy('ow.id', 'ASC')
      .limit(limit)
      .getRawMany<{
        ownerId: string;
        name: string;
        email: string;
        count: string;
      }>();
    return this.toRankingRows(raw);
  }

  private toWeekRows(
    raw: Array<{ weekStart: string; count: string }>,
  ): AdminUsageWeekRow[] {
    return raw.map((r) => ({ weekStart: r.weekStart, count: Number(r.count) }));
  }

  private toRankingRows(
    raw: Array<{ ownerId: string; name: string; email: string; count: string }>,
  ): AdminUsageRankingRow[] {
    return raw.map((r) => ({
      ownerId: r.ownerId,
      name: r.name,
      email: r.email,
      count: Number(r.count),
    }));
  }
}
