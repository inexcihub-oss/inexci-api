import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PlatformAdmin,
  PlatformAdminStatus,
} from '../entities/platform-admin.entity';
import { BaseRepository } from './base.repository';
import { PlatformAdminInvite } from './platform-admin.repository';

export interface PlatformAdminTeamRow {
  id: string;
  name: string;
  email: string;
  status: PlatformAdminStatus;
  mfaEnabled: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
  createdById: string | null;
  createdByName: string | null;
}

export type RevokePlatformAdminOutcome =
  | { result: 'not_found' }
  | { result: 'already_inactive' }
  | { result: 'last_active_admin' }
  | { result: 'revoked'; before: { status: PlatformAdminStatus } };

export type ResetPlatformAdminOutcome =
  | { result: 'not_found' }
  | {
      result: 'reset';
      before: { status: PlatformAdminStatus; mfaEnabled: boolean };
      name: string;
      email: string;
    };

interface RawTeamRow {
  id: string;
  name: string;
  email: string;
  status: PlatformAdminStatus;
  mfa_enabled_at: Date | null;
  last_seen_at: Date | null;
  created_at: Date;
  created_by_id: string | null;
  created_by_name: string | null;
}

@Injectable()
export class PlatformAdminTeamRepository extends BaseRepository<PlatformAdmin> {
  constructor(
    @InjectRepository(PlatformAdmin) repository: Repository<PlatformAdmin>,
  ) {
    super(repository);
  }

  async listTeam(): Promise<PlatformAdminTeamRow[]> {
    const rows = await this.repository
      .createQueryBuilder('a')
      .leftJoin('a.createdBy', 'c')
      .select('a.id', 'id')
      .addSelect('a.name', 'name')
      .addSelect('a.email', 'email')
      .addSelect('a.status', 'status')
      .addSelect('a.mfaEnabledAt', 'mfa_enabled_at')
      .addSelect('a.lastSeenAt', 'last_seen_at')
      .addSelect('a.createdAt', 'created_at')
      .addSelect('a.createdById', 'created_by_id')
      .addSelect('c.name', 'created_by_name')
      .orderBy('a.createdAt', 'ASC')
      .addOrderBy('a.id', 'ASC')
      .getRawMany<RawTeamRow>();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      status: row.status,
      mfaEnabled: !!row.mfa_enabled_at,
      lastSeenAt: row.last_seen_at ?? null,
      createdAt: row.created_at,
      createdById: row.created_by_id ?? null,
      createdByName: row.created_by_name ?? null,
    }));
  }

  revokeKeepingOneActive(
    targetId: string,
  ): Promise<RevokePlatformAdminOutcome> {
    return this.repository.manager.transaction(async (manager) => {
      const admins = await manager
        .createQueryBuilder(PlatformAdmin, 'a')
        .select(['a.id', 'a.status'])
        .orderBy('a.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();

      const target = admins.find((admin) => admin.id === targetId);
      if (!target) return { result: 'not_found' as const };
      if (target.status === PlatformAdminStatus.INACTIVE) {
        return { result: 'already_inactive' as const };
      }

      const othersActive = admins.some(
        (admin) =>
          admin.id !== targetId && admin.status === PlatformAdminStatus.ACTIVE,
      );
      if (target.status === PlatformAdminStatus.ACTIVE && !othersActive) {
        return { result: 'last_active_admin' as const };
      }

      await manager
        .createQueryBuilder()
        .update(PlatformAdmin)
        .set({
          status: PlatformAdminStatus.INACTIVE,
          inviteTokenHash: null,
          inviteExpiresAt: null,
          tokenVersion: () => 'token_version + 1',
        })
        .where('id = :targetId', { targetId })
        .execute();

      return {
        result: 'revoked' as const,
        before: { status: target.status },
      };
    });
  }

  resetAccess(
    targetId: string,
    invite: PlatformAdminInvite,
  ): Promise<ResetPlatformAdminOutcome> {
    return this.repository.manager.transaction(async (manager) => {
      const target = await manager
        .createQueryBuilder(PlatformAdmin, 'a')
        .select(['a.id', 'a.name', 'a.email', 'a.status', 'a.mfaEnabledAt'])
        .where('a.id = :targetId', { targetId })
        .setLock('pessimistic_write')
        .getOne();
      if (!target) return { result: 'not_found' as const };

      await manager
        .createQueryBuilder()
        .update(PlatformAdmin)
        .set({
          passwordHash: null,
          status: PlatformAdminStatus.PENDING,
          mfaSecret: null,
          mfaPendingSecret: null,
          mfaEnabledAt: null,
          mfaRecoveryCodes: null,
          mfaLastUsedStep: null,
          inviteTokenHash: invite.inviteTokenHash,
          inviteExpiresAt: invite.inviteExpiresAt,
          tokenVersion: () => 'token_version + 1',
        })
        .where('id = :targetId', { targetId })
        .execute();

      return {
        result: 'reset' as const,
        before: {
          status: target.status,
          mfaEnabled: !!target.mfaEnabledAt,
        },
        name: target.name,
        email: target.email,
      };
    });
  }
}
