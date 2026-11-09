import { Injectable } from '@nestjs/common';
import {
  PlatformAuditAction,
  PlatformAuditLog,
  PlatformAuditStatus,
} from 'src/database/entities/platform-audit-log.entity';
import {
  PlatformAuditLastRun,
  PlatformAuditLogFilter,
  PlatformAuditLogRepository,
  PlatformAuditLogRow,
} from 'src/database/repositories/platform-audit-log.repository';

export interface PlatformAuditBeginInput {
  actorAdminId: string;
  action: PlatformAuditAction;
  targetOwnerId?: string | null;
  targetUserId?: string | null;
  targetAdminId?: string | null;
  reason?: string | null;
  before?: Record<string, unknown> | null;
}

export interface PlatformAuditSucceedInput {
  after?: Record<string, unknown> | null;
  gatewayRef?: string | null;
  targetAdminId?: string;
}

@Injectable()
export class PlatformAuditService {
  constructor(private readonly repository: PlatformAuditLogRepository) {}

  begin(input: PlatformAuditBeginInput): Promise<PlatformAuditLog> {
    return this.repository.create({
      actorAdminId: input.actorAdminId,
      action: input.action,
      targetOwnerId: input.targetOwnerId ?? null,
      targetUserId: input.targetUserId ?? null,
      targetAdminId: input.targetAdminId ?? null,
      reason: input.reason ?? null,
      before: input.before ?? null,
      status: PlatformAuditStatus.PENDING,
    });
  }

  succeed(id: string, data: PlatformAuditSucceedInput = {}): Promise<void> {
    return this.repository.markSucceeded(id, {
      after: data.after ?? null,
      gatewayRef: data.gatewayRef ?? null,
      ...(data.targetAdminId ? { targetAdminId: data.targetAdminId } : {}),
    });
  }

  fail(
    id: string,
    error: string,
    gatewayRef: string | null = null,
  ): Promise<void> {
    return this.repository.markFailed(id, error, gatewayRef);
  }

  list(
    filter: PlatformAuditLogFilter,
  ): Promise<{ items: PlatformAuditLogRow[]; total: number }> {
    return this.repository.search(filter);
  }

  lastSucceeded(
    actions: PlatformAuditAction[],
  ): Promise<Map<PlatformAuditAction, PlatformAuditLastRun>> {
    return this.repository.findLastSucceededByAction(actions);
  }
}
