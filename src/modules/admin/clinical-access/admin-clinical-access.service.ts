import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import {
  ClinicalAccessByUserRow,
  ClinicalAccessEventRow,
  ClinicalAccessVolumeFilter,
  ClinicalAccessVolumeRepository,
} from 'src/database/repositories/clinical-access-volume.repository';
import { errorMessage } from 'src/shared/utils/error-message.util';
import { maskSensitiveText } from 'src/shared/utils/mask.util';
import { PlatformAuditService } from '../audit/platform-audit.service';
import {
  AdminClinicalAccessDto,
  AdminClinicalAccessExportResultDto,
  AdminClinicalAccessPatientResultDto,
  AdminClinicalAccessUserDto,
} from './dto/admin-clinical-access.dto';

const DEFAULT_DAYS = 30;
const TOP_PATIENTS = 50;
const PATIENT_EVENTS_LIMIT = 200;
const PATIENT_REF_LENGTH = 10;

export function patientRefOf(patient: string): string {
  const normalized = patient.trim().toLowerCase();
  if (normalized.length === PATIENT_REF_LENGTH) return normalized;
  return createHash('md5')
    .update(normalized)
    .digest('hex')
    .slice(0, PATIENT_REF_LENGTH);
}
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toUserDto(row: ClinicalAccessByUserRow): AdminClinicalAccessUserDto {
  return {
    userId: row.userId,
    userName: row.userName,
    resource: row.resource,
    action: row.action,
    total: row.total,
    lastAccessAt: row.lastAccessAt,
  };
}

@Injectable()
export class AdminClinicalAccessService {
  constructor(
    private readonly volume: ClinicalAccessVolumeRepository,
    private readonly audit: PlatformAuditService,
  ) {}

  private filterOf(
    ownerId: string,
    days: number | undefined,
    now: Date,
  ): ClinicalAccessVolumeFilter {
    return {
      ownerId,
      from: new Date(now.getTime() - (days ?? DEFAULT_DAYS) * MS_PER_DAY),
      to: now,
    };
  }

  async forAccount(
    ownerId: string,
    days?: number,
    now: Date = new Date(),
  ): Promise<AdminClinicalAccessDto> {
    const filter = this.filterOf(ownerId, days, now);
    const [totals, byAction, byUser, daily, byPatient] = await Promise.all([
      this.volume.totals(filter),
      this.volume.byAction(filter),
      this.volume.byUser(filter),
      this.volume.daily(filter),
      this.volume.byPatient(filter, TOP_PATIENTS),
    ]);
    return {
      ownerId,
      from: filter.from,
      to: filter.to,
      totals,
      byAction: byAction.map((row) => ({
        resource: row.resource,
        action: row.action,
        origin: row.origin,
        total: row.total,
      })),
      byUser: byUser.map(toUserDto),
      daily,
      byPatient: byPatient.map((row) => ({
        patientRef: row.patientRef,
        total: row.total,
        users: row.users,
        lastAccessAt: row.lastAccessAt,
      })),
    };
  }

  async forPatient(
    ownerId: string,
    input: { reason: string; patient: string; days?: number },
    actorAdminId: string,
    now: Date = new Date(),
  ): Promise<AdminClinicalAccessPatientResultDto> {
    const filter = this.filterOf(ownerId, input.days, now);
    const patientRef = patientRefOf(input.patient);
    const entry = await this.audit.begin({
      actorAdminId,
      action: PlatformAuditAction.CLINICAL_ACCESS_PATIENT_VIEWED,
      targetOwnerId: ownerId,
      reason: input.reason,
      before: {
        patientRef,
        days: input.days ?? DEFAULT_DAYS,
        from: filter.from.toISOString(),
        to: filter.to.toISOString(),
      },
    });
    let rows: ClinicalAccessEventRow[];
    try {
      rows = await this.volume.patientEvents(
        filter,
        patientRef,
        PATIENT_EVENTS_LIMIT,
      );
    } catch (err) {
      await this.audit.fail(
        entry.id,
        maskSensitiveText(errorMessage(err)).slice(0, 500),
      );
      throw err;
    }
    await this.audit.succeed(entry.id, { after: { rows: rows.length } });
    return {
      auditLogId: entry.id,
      patientRef,
      from: filter.from,
      to: filter.to,
      limit: PATIENT_EVENTS_LIMIT,
      items: rows.map((row) => ({
        userId: row.userId,
        userName: row.userName,
        resource: row.resource,
        action: row.action,
        origin: row.origin,
        createdAt: row.createdAt,
      })),
    };
  }

  async export(
    ownerId: string,
    input: { reason: string; days?: number },
    actorAdminId: string,
    now: Date = new Date(),
  ): Promise<AdminClinicalAccessExportResultDto> {
    const filter = this.filterOf(ownerId, input.days, now);
    const entry = await this.audit.begin({
      actorAdminId,
      action: PlatformAuditAction.CLINICAL_ACCESS_EXPORTED,
      targetOwnerId: ownerId,
      reason: input.reason,
      before: {
        days: input.days ?? DEFAULT_DAYS,
        from: filter.from.toISOString(),
        to: filter.to.toISOString(),
      },
    });
    let rows: ClinicalAccessByUserRow[];
    try {
      rows = await this.volume.byUser(filter);
    } catch (err) {
      await this.audit.fail(
        entry.id,
        maskSensitiveText(errorMessage(err)).slice(0, 500),
      );
      throw err;
    }
    await this.audit.succeed(entry.id, { after: { rows: rows.length } });
    return {
      auditLogId: entry.id,
      from: filter.from,
      to: filter.to,
      items: rows.map(toUserDto),
    };
  }
}
