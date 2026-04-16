import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';

const STATUS_LABELS: Record<SurgeryRequestStatus, string> = {
  [SurgeryRequestStatus.PENDING]: 'Pendente',
  [SurgeryRequestStatus.SENT]: 'Enviada',
  [SurgeryRequestStatus.IN_ANALYSIS]: 'Em Análise',
  [SurgeryRequestStatus.IN_SCHEDULING]: 'Em Agendamento',
  [SurgeryRequestStatus.SCHEDULED]: 'Agendada',
  [SurgeryRequestStatus.PERFORMED]: 'Realizada',
  [SurgeryRequestStatus.INVOICED]: 'Faturada',
  [SurgeryRequestStatus.FINALIZED]: 'Finalizada',
  [SurgeryRequestStatus.CLOSED]: 'Encerrada',
};

export function getStatusLabel(status: number): string {
  return STATUS_LABELS[status as SurgeryRequestStatus] ?? String(status);
}
