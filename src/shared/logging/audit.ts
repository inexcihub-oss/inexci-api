import { Logger } from '@nestjs/common';

const auditLogger = new Logger('Audit');

export type ProntuarioResource =
  | 'surgery_request'
  | 'patient'
  | 'clinical_record';

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
