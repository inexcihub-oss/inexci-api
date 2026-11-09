import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../entities/user.entity';
import type { OnboardingState } from 'src/modules/onboarding/onboarding.types';
import { BaseRepository } from './base.repository';
import { CLIENT_OWNER_IDS_SQL } from './admin-accounts.repository';

export interface ActivationMilestonesRow {
  ownerId: string;
  signupAt: Date;
  firstPatientAt: Date | null;
  firstAppointmentAt: Date | null;
  firstSurgeryRequestAt: Date | null;
  firstSentAt: Date | null;
  firstWhatsappAt: Date | null;
}

export interface MemberOnboardingRow {
  userId: string;
  status: UserStatus;
  onboardingState: OnboardingState | null;
}

export interface MemberUsageRow {
  userId: string;
  surgeryRequests: number;
  appointments: number;
  recordsFinalized: number;
  assistantMessages: number;
  aiCostUsdCents: number;
}

interface RawMilestonesRow {
  ownerId: string;
  signupAt: Date | string;
  firstPatientAt: Date | string | null;
  firstAppointmentAt: Date | string | null;
  firstSurgeryRequestAt: Date | string | null;
  firstSentAt: Date | string | null;
  firstWhatsappAt: Date | string | null;
}

interface RawUsageRow {
  userId: string;
  surgeryRequests: string | number | null;
  appointments: string | number | null;
  recordsFinalized: string | number | null;
  assistantMessages: string | number | null;
  aiCostUsdCents: string | number | null;
}

const MILESTONES_SELECT = `
  SELECT o.id AS "ownerId",
    o.created_at AS "signupAt",
    (SELECT MIN(p.created_at) FROM patients p WHERE p.owner_id = o.id) AS "firstPatientAt",
    (SELECT MIN(a.created_at) FROM appointments a WHERE a.owner_id = o.id) AS "firstAppointmentAt",
    (SELECT MIN(sr.created_at) FROM surgery_requests sr WHERE sr.owner_id = o.id) AS "firstSurgeryRequestAt",
    (SELECT MIN(sr.sent_at) FROM surgery_requests sr WHERE sr.owner_id = o.id) AS "firstSentAt",
    LEAST(
      (SELECT MIN(m.created_at) FROM whatsapp_conversation_messages m
         INNER JOIN whatsapp_conversations c ON c.id = m.conversation_id
         WHERE c.owner_id = o.id AND m.role = 'user'),
      (SELECT MIN(l.created_at) FROM ai_token_usage_logs l WHERE l.owner_id = o.id)
    ) AS "firstWhatsappAt"
  FROM users o`;

function toDate(value: Date | string | null): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

function toMilestones(row: RawMilestonesRow): ActivationMilestonesRow {
  return {
    ownerId: row.ownerId,
    signupAt: toDate(row.signupAt) as Date,
    firstPatientAt: toDate(row.firstPatientAt),
    firstAppointmentAt: toDate(row.firstAppointmentAt),
    firstSurgeryRequestAt: toDate(row.firstSurgeryRequestAt),
    firstSentAt: toDate(row.firstSentAt),
    firstWhatsappAt: toDate(row.firstWhatsappAt),
  };
}

@Injectable()
export class AdminActivationRepository extends BaseRepository<User> {
  constructor(@InjectRepository(User) repo: Repository<User>) {
    super(repo);
  }

  async findMilestones(
    ownerId: string,
  ): Promise<ActivationMilestonesRow | null> {
    const rows: RawMilestonesRow[] = await this.repository.manager.query(
      `${MILESTONES_SELECT} WHERE o.id = $1 AND o.owner_id = o.id`,
      [ownerId],
    );
    return rows[0] ? toMilestones(rows[0]) : null;
  }

  async findCohortMilestones(range: {
    from: Date;
    to: Date;
  }): Promise<ActivationMilestonesRow[]> {
    const rows: RawMilestonesRow[] = await this.repository.manager.query(
      `${MILESTONES_SELECT}
       WHERE o.owner_id = o.id
         AND o.deleted_at IS NULL
         AND o.id IN ${CLIENT_OWNER_IDS_SQL}
         AND o.created_at >= $1 AND o.created_at < $2`,
      [range.from, range.to],
    );
    return rows.map(toMilestones);
  }

  async findMembersOnboarding(ownerId: string): Promise<MemberOnboardingRow[]> {
    const users = await this.repository.find({
      select: { id: true, status: true, onboardingState: true },
      where: { ownerId },
      order: { name: 'ASC', id: 'ASC' },
    });
    return users.map((u) => ({
      userId: u.id,
      status: u.status,
      onboardingState: u.onboardingState ?? null,
    }));
  }

  async findMemberUsage(
    ownerId: string,
    range: { from: Date; to: Date },
  ): Promise<MemberUsageRow[]> {
    const rows: RawUsageRow[] = await this.repository.manager.query(
      `SELECT u.id AS "userId",
         (SELECT COUNT(*) FROM surgery_requests sr
            WHERE sr.owner_id = $1 AND sr.created_by_id = u.id
              AND sr.created_at >= $2 AND sr.created_at < $3) AS "surgeryRequests",
         (SELECT COUNT(*) FROM appointments a
            WHERE a.owner_id = $1 AND a.created_by_id = u.id AND a.deleted_at IS NULL
              AND a.created_at >= $2 AND a.created_at < $3) AS "appointments",
         (SELECT COUNT(*) FROM clinical_records cr
            WHERE cr.owner_id = $1 AND cr.doctor_id = u.id
              AND cr.finalized_at >= $2 AND cr.finalized_at < $3) AS "recordsFinalized",
         (SELECT COUNT(*) FROM whatsapp_conversation_messages m
            INNER JOIN whatsapp_conversations c ON c.id = m.conversation_id
            WHERE c.owner_id = $1 AND c.user_id = u.id AND m.role = 'user'
              AND m.created_at >= $2 AND m.created_at < $3) AS "assistantMessages",
         (SELECT COALESCE(SUM(l.cost_estimate_cents), 0) FROM ai_token_usage_logs l
            WHERE l.owner_id = $1 AND l.user_id = u.id
              AND l.created_at >= $2 AND l.created_at < $3) AS "aiCostUsdCents"
       FROM users u
       WHERE u.owner_id = $1 AND u.deleted_at IS NULL`,
      [ownerId, range.from, range.to],
    );
    return rows.map((r) => ({
      userId: r.userId,
      surgeryRequests: Number(r.surgeryRequests) || 0,
      appointments: Number(r.appointments) || 0,
      recordsFinalized: Number(r.recordsFinalized) || 0,
      assistantMessages: Number(r.assistantMessages) || 0,
      aiCostUsdCents: Number(r.aiCostUsdCents) || 0,
    }));
  }
}
