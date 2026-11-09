import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PlatformAdmin,
  PlatformAdminStatus,
} from '../entities/platform-admin.entity';
import { BaseRepository } from './base.repository';

export interface PlatformAdminInvite {
  inviteTokenHash: string;
  inviteExpiresAt: Date;
}

const SELECT_SESSAO = {
  id: true,
  name: true,
  email: true,
  status: true,
  tokenVersion: true,
  mfaEnabledAt: true,
} as const;

@Injectable()
export class PlatformAdminRepository extends BaseRepository<PlatformAdmin> {
  constructor(
    @InjectRepository(PlatformAdmin) repository: Repository<PlatformAdmin>,
  ) {
    super(repository);
  }

  findForLogin(email: string): Promise<PlatformAdmin | null> {
    return this.repository
      .createQueryBuilder('a')
      .select([
        'a.id',
        'a.name',
        'a.email',
        'a.status',
        'a.tokenVersion',
        'a.mfaEnabledAt',
      ])
      .addSelect('a.passwordHash')
      .where('lower(a.email) = lower(:email)', { email })
      .getOne();
  }

  findSession(id: string): Promise<PlatformAdmin | null> {
    return this.repository.findOne({ where: { id }, select: SELECT_SESSAO });
  }

  findByEmail(email: string): Promise<PlatformAdmin | null> {
    return this.repository
      .createQueryBuilder('a')
      .select(['a.id', 'a.status'])
      .where('lower(a.email) = lower(:email)', { email })
      .getOne();
  }

  findName(id: string): Promise<string | null> {
    return this.repository
      .findOne({ where: { id }, select: { id: true, name: true } })
      .then((admin) => admin?.name ?? null);
  }

  findMfaState(id: string): Promise<PlatformAdmin | null> {
    return this.repository.findOne({
      where: { id },
      select: {
        ...SELECT_SESSAO,
        mfaSecret: true,
        mfaPendingSecret: true,
        mfaRecoveryCodes: true,
      },
    });
  }

  findInvite(email: string): Promise<PlatformAdmin | null> {
    return this.repository
      .createQueryBuilder('a')
      .select(['a.id', 'a.status'])
      .addSelect(['a.inviteTokenHash', 'a.inviteExpiresAt'])
      .where('lower(a.email) = lower(:email)', { email })
      .getOne();
  }

  async acceptInvite(
    id: string,
    inviteTokenHash: string,
    passwordHash: string,
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(PlatformAdmin)
      .set({
        passwordHash,
        status: PlatformAdminStatus.ACTIVE,
        inviteTokenHash: null,
        inviteExpiresAt: null,
        tokenVersion: () => 'token_version + 1',
      })
      .where('id = :id', { id })
      .andWhere('status = :pending', { pending: PlatformAdminStatus.PENDING })
      .andWhere('invite_token_hash = :inviteTokenHash', { inviteTokenHash })
      .andWhere('invite_expires_at > now()')
      .execute();
    return (result.affected ?? 0) > 0;
  }

  createInvited(data: {
    name: string;
    email: string;
    createdById: string;
    invite: PlatformAdminInvite;
  }): Promise<PlatformAdmin> {
    return this.create({
      name: data.name,
      email: data.email,
      status: PlatformAdminStatus.PENDING,
      passwordHash: null,
      createdById: data.createdById,
      inviteTokenHash: data.invite.inviteTokenHash,
      inviteExpiresAt: data.invite.inviteExpiresAt,
    });
  }

  async touchLastSeen(id: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(PlatformAdmin)
      .set({ lastSeenAt: () => 'now()', updatedAt: () => 'updated_at' })
      .where('id = :id', { id })
      .andWhere(
        "(last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes')",
      )
      .execute();
  }

  async savePendingMfaSecret(id: string, secret: string): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(PlatformAdmin)
      .set({ mfaPendingSecret: secret })
      .where('id = :id', { id })
      .andWhere('mfa_enabled_at IS NULL')
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async enableMfa(
    id: string,
    data: { secret: string; recoveryCodeHashes: string[]; usedStep: number },
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(PlatformAdmin)
      .set({
        mfaSecret: data.secret,
        mfaPendingSecret: null,
        mfaEnabledAt: () => 'now()',
        mfaRecoveryCodes: data.recoveryCodeHashes,
        mfaLastUsedStep: data.usedStep,
      })
      .where('id = :id', { id })
      .andWhere('mfa_enabled_at IS NULL')
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async consumeMfaStep(id: string, step: number): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(PlatformAdmin)
      .set({ mfaLastUsedStep: step })
      .where('id = :id', { id })
      .andWhere('mfa_enabled_at IS NOT NULL')
      .andWhere('(mfa_last_used_step IS NULL OR mfa_last_used_step < :step)', {
        step,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async consumeMfaRecoveryCode(id: string, codeHash: string): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(PlatformAdmin)
      .set({
        mfaRecoveryCodes: () => 'array_remove(mfa_recovery_codes, :codeHash)',
      })
      .where('id = :id', { id })
      .andWhere('mfa_enabled_at IS NOT NULL')
      .andWhere(':codeHash = ANY(mfa_recovery_codes)')
      .setParameter('codeHash', codeHash)
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async replaceMfaRecoveryCodes(
    id: string,
    recoveryCodeHashes: string[],
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(PlatformAdmin)
      .set({ mfaRecoveryCodes: recoveryCodeHashes })
      .where('id = :id', { id })
      .andWhere('mfa_enabled_at IS NOT NULL')
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async incrementTokenVersion(id: string): Promise<void> {
    await this.repository.increment({ id }, 'tokenVersion', 1);
  }
}
