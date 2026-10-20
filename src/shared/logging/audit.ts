import { Logger } from '@nestjs/common';
import type { ClinicalAccessOrigin } from 'src/database/entities/clinical-access-audit.entity';
import type { ClinicalAccessAuditEntry } from 'src/database/repositories/clinical-access-audit.repository';
import { getRequestContext } from './request-context';

const auditLogger = new Logger('Audit');

export type ProntuarioResource =
  | 'surgery_request'
  | 'patient'
  | 'clinical_record';

export type ProntuarioAuditSink = (
  entry: ClinicalAccessAuditEntry,
) => Promise<void>;

let sink: ProntuarioAuditSink | null = null;

export function registerProntuarioAuditSink(
  novo: ProntuarioAuditSink | null,
): void {
  sink = novo;
}

export function auditProntuarioAccess(input: {
  resource: ProntuarioResource;
  resourceId?: string | null;
  action: string;
  actorUserId?: string | null;
  tenantId?: string | null;
  patientId?: string | null;
  origin?: ClinicalAccessOrigin;
}): void {
  const contexto = getRequestContext();
  const origin: ClinicalAccessOrigin =
    input.origin ?? (contexto ? 'http' : 'system');

  auditLogger.log({
    event: 'prontuario_access',
    resource: input.resource,
    resourceId: input.resourceId ?? null,
    action: input.action,
    actorUserId: input.actorUserId ?? null,
    tenantId: input.tenantId ?? null,
  });

  if (!sink) return;

  const entry: ClinicalAccessAuditEntry = {
    actorUserId: input.actorUserId ?? null,
    ownerId: input.tenantId ?? null,
    action: input.action.slice(0, 32),
    resource: input.resource,
    resourceId: input.resourceId ? input.resourceId.slice(0, 64) : null,
    patientId: input.patientId ?? null,
    origin,
    ip: contexto?.ip ? contexto.ip.slice(0, 64) : null,
    requestId: contexto?.requestId ?? null,
  };

  try {
    sink(entry).catch((erro: unknown) => {
      auditLogger.warn(
        `Falha ao persistir auditoria de prontuário (${input.resource}/${input.action}): ${erro instanceof Error ? erro.message : String(erro)}`,
      );
    });
  } catch (erro: unknown) {
    auditLogger.warn(
      `Falha ao persistir auditoria de prontuário (${input.resource}/${input.action}): ${erro instanceof Error ? erro.message : String(erro)}`,
    );
  }
}
