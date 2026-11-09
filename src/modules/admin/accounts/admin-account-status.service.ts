import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import { SubscriptionStatus } from 'src/database/entities/subscription.entity';
import { User } from 'src/database/entities/user.entity';
import { SubscriptionRepository } from 'src/database/repositories/subscription.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { SessionRevocationService } from 'src/modules/auth/session-revocation.service';
import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from 'src/shared/payment-gateway/payment-gateway.interface';
import { GatewaySubscription } from 'src/shared/payment-gateway/payment-gateway.types';
import { PlatformAuditService } from '../audit/platform-audit.service';
import {
  deactivationBlock,
  lookupGatewaySubscriptions,
} from '../subscriptions/subscription-admin-rules';
import { AdminAccountStatusResultDto } from './dto/admin-account-status.dto';

interface StatusContext {
  auditId: string | null;
  failDetail: string | null;
}

@Injectable()
export class AdminAccountStatusService {
  private readonly logger = new Logger(AdminAccountStatusService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly userRepository: UserRepository,
    private readonly subscriptionRepo: SubscriptionRepository,
    private readonly audit: PlatformAuditService,
    private readonly sessionRevocation: SessionRevocationService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  async deactivate(
    ownerId: string,
    actorAdminId: string,
    reason: string,
    now: Date = new Date(),
  ): Promise<AdminAccountStatusResultDto> {
    const ctx: StatusContext = { auditId: null, failDetail: null };
    try {
      await this.dataSource.transaction(async (manager) => {
        const owner = await this.lockOwner(ownerId, manager);
        if (owner.accountDeactivatedAt) {
          throw new ConflictException('A conta já está desativada.');
        }
        const snapshot = this.snapshotOf(owner);
        const log = await this.audit.begin({
          actorAdminId,
          action: PlatformAuditAction.ACCOUNT_DEACTIVATED,
          targetOwnerId: ownerId,
          reason,
          before: snapshot,
        });
        ctx.auditId = log.id;

        const sub = await this.subscriptionRepo.lockByOwnerId(ownerId, manager);
        if (sub) {
          const remote =
            sub.status === SubscriptionStatus.INTERNAL
              ? []
              : await this.lookupOrNull(sub, ctx);
          const block = deactivationBlock(sub.status, remote);
          if (block) {
            throw block.kind === 'gateway_unavailable'
              ? new ServiceUnavailableException(block.message)
              : new ConflictException(block.message);
          }
        }

        await this.userRepository.setAccountDeactivation(
          ownerId,
          { at: now, byId: actorAdminId },
          manager,
        );
      });
    } catch (err) {
      await this.recordFailure(ctx, err);
      throw err;
    }

    const revocation = await this.revokeAccountSessions(ownerId);
    await this.recordSuccess(ctx, {
      accountDeactivatedAt: now.toISOString(),
      accountDeactivatedById: actorAdminId,
      revokedUsers: revocation.revoked,
      revocationFailures: revocation.failed,
    });

    return {
      auditLogId: ctx.auditId!,
      accountDeactivatedAt: now,
      revokedUsers: revocation.revoked,
    };
  }

  async reactivate(
    ownerId: string,
    actorAdminId: string,
    reason: string,
  ): Promise<AdminAccountStatusResultDto> {
    const ctx: StatusContext = { auditId: null, failDetail: null };
    try {
      await this.dataSource.transaction(async (manager) => {
        const owner = await this.lockOwner(ownerId, manager);
        if (!owner.accountDeactivatedAt) {
          throw new ConflictException('A conta não está desativada.');
        }
        const log = await this.audit.begin({
          actorAdminId,
          action: PlatformAuditAction.ACCOUNT_REACTIVATED,
          targetOwnerId: ownerId,
          reason,
          before: this.snapshotOf(owner),
        });
        ctx.auditId = log.id;
        await this.userRepository.setAccountDeactivation(
          ownerId,
          { at: null, byId: null },
          manager,
        );
      });
    } catch (err) {
      await this.recordFailure(ctx, err);
      throw err;
    }

    await this.recordSuccess(ctx, {
      accountDeactivatedAt: null,
      accountDeactivatedById: null,
    });
    await this.notifyAccessChanged(ownerId);

    return {
      auditLogId: ctx.auditId!,
      accountDeactivatedAt: null,
      revokedUsers: 0,
    };
  }

  private async lockOwner(
    ownerId: string,
    manager: Parameters<UserRepository['lockAccountOwner']>[1],
  ): Promise<User> {
    const owner = await this.userRepository.lockAccountOwner(ownerId, manager);
    if (!owner) throw new NotFoundException('Conta não encontrada');
    return owner;
  }

  private async revokeAccountSessions(
    ownerId: string,
  ): Promise<{ revoked: number; failed: number }> {
    const members = await this.userRepository.findAccountMembers(ownerId);
    for (const member of members) this.emitAccessChanged(member);
    const results = await Promise.allSettled(
      members.map((member) =>
        this.sessionRevocation.revokeAllSessions(
          member.id,
          'account_deactivated',
        ),
      ),
    );
    let revoked = 0;
    let failed = 0;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        revoked += 1;
        return;
      }
      failed += 1;
      const err: unknown = result.reason;
      this.logger.error(
        `[admin-account-status] falha ao encerrar sessões de user=${members[index].id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
    return { revoked, failed };
  }

  private async notifyAccessChanged(ownerId: string): Promise<void> {
    try {
      const members = await this.userRepository.findAccountMembers(ownerId);
      for (const member of members) this.emitAccessChanged(member);
    } catch (err) {
      this.logger.warn(
        `[admin-account-status] falha ao avisar caches da conta ${ownerId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private emitAccessChanged(member: Pick<User, 'id' | 'phone'>): void {
    this.eventEmitter?.emit('user.access_changed', {
      userId: member.id,
      phone: member.phone,
    });
  }

  private async lookupOrNull(
    sub: Parameters<typeof lookupGatewaySubscriptions>[1] & { id: string },
    ctx: StatusContext,
  ): Promise<GatewaySubscription[] | null> {
    try {
      return await lookupGatewaySubscriptions(this.gateway, sub);
    } catch (err) {
      ctx.failDetail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[admin-account-status] consulta à Stripe falhou para subscription=${sub.id}: ${ctx.failDetail}`,
      );
      return null;
    }
  }

  private async recordFailure(ctx: StatusContext, err: unknown): Promise<void> {
    if (!ctx.auditId) return;
    const message = err instanceof Error ? err.message : String(err);
    const detail = ctx.failDetail ? `${message} (${ctx.failDetail})` : message;
    try {
      await this.audit.fail(ctx.auditId, detail.slice(0, 2000), null);
    } catch (auditErr) {
      this.logger.error(
        `[admin-account-status] falha ao marcar auditoria ${ctx.auditId} como failed: ${
          auditErr instanceof Error ? auditErr.message : String(auditErr)
        }`,
      );
    }
  }

  private async recordSuccess(
    ctx: StatusContext,
    after: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.succeed(ctx.auditId!, { after, gatewayRef: null });
    } catch (auditErr) {
      this.logger.error(
        `[admin-account-status] ação concluída mas a auditoria ${ctx.auditId} ficou pending: ${
          auditErr instanceof Error ? auditErr.message : String(auditErr)
        }`,
      );
    }
  }

  private snapshotOf(owner: User): Record<string, unknown> {
    return {
      accountDeactivatedAt: owner.accountDeactivatedAt
        ? owner.accountDeactivatedAt.toISOString()
        : null,
      accountDeactivatedById: owner.accountDeactivatedById ?? null,
    };
  }
}
