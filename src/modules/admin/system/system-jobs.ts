import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';

export type SystemJobKey = 'stale_requests' | 'weekly_summary';

export interface SystemJobDefinition {
  key: SystemJobKey;
  name: string;
  description: string;
  schedule: string;
  action: PlatformAuditAction;
}

export const SYSTEM_JOBS: readonly SystemJobDefinition[] = [
  {
    key: 'stale_requests',
    name: 'Solicitações paradas',
    description:
      'Procura solicitações cirúrgicas sem movimentação além do prazo esperado e avisa os responsáveis.',
    schedule: 'Todo dia às 07:00',
    action: PlatformAuditAction.CRON_STALE_REQUESTS_TRIGGERED,
  },
  {
    key: 'weekly_summary',
    name: 'Resumo semanal',
    description:
      'Envia por e-mail o resumo da semana para todos os usuários elegíveis.',
    schedule: 'Domingos às 08:00',
    action: PlatformAuditAction.CRON_WEEKLY_SUMMARY_TRIGGERED,
  },
];

export function systemJob(key: SystemJobKey): SystemJobDefinition {
  const job = SYSTEM_JOBS.find((item) => item.key === key);
  if (!job) throw new Error(`Tarefa desconhecida: ${key}`);
  return job;
}

export function systemJobLockKey(key: SystemJobKey): string {
  return `system-job:${key}`;
}
