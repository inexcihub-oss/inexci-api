import { Logger } from '@nestjs/common';

const auditLogger = new Logger('Audit');

export type ProntuarioResource = 'surgery_request' | 'patient';

/**
 * Emite um evento de auditoria LGPD de acesso a prontuário (dado sensível de
 * saúde — Art. 11). Vai como linha JSON estruturada pelo `InexciLogger` (campo
 * `event: prontuario_access` achatado no root → coluna filtrável no Loki), com
 * `requestId`/`traceId` injetados automaticamente pelo request-context.
 *
 * ponytail: trilha via log estruturado — retenção = a do pipeline de logs
 * (Loki). Migrar para tabela `prontuario_access_log` só se exigirem retenção
 * legal longa com consulta in-app pelo DPO.
 */
export function auditProntuarioAccess(input: {
  resource: ProntuarioResource;
  resourceId: string;
  action: string;
  actorUserId?: string | null;
  tenantId?: string | null;
}): void {
  auditLogger.log({
    event: 'prontuario_access',
    resource: input.resource,
    resourceId: input.resourceId,
    action: input.action,
    actorUserId: input.actorUserId ?? null,
    tenantId: input.tenantId ?? null,
  });
}
