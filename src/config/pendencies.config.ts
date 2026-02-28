import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';

export type PendencyResponsibleRole = 'collaborator' | 'patient' | 'doctor';

export interface PendencyConfig {
  /** Chave única da pendência */
  key: string;
  /** Label exibido ao usuário */
  label: string;
  /** Se true, bloqueia a transição de status. Se false, é apenas um aviso. */
  blocking: boolean;
  responsibleRole: PendencyResponsibleRole;
}

export interface StatusPendenciesConfig {
  status: SurgeryRequestStatus;
  label: string;
  pendencies: PendencyConfig[];
}

/**
 * Configuração central de pendências por status.
 * Fonte de verdade para o PendencyValidatorService.
 */
export const PENDENCIES_CONFIG: StatusPendenciesConfig[] = [
  {
    status: SurgeryRequestStatus.PENDING,
    label: 'Pendente',
    pendencies: [
      {
        key: 'patient_data',
        label: 'Dados do Paciente',
        blocking: true,
        responsibleRole: 'collaborator',
      },
      {
        key: 'hospital_data',
        label: 'Hospital',
        blocking: true,
        responsibleRole: 'collaborator',
      },
      {
        key: 'tuss_procedures',
        label: 'Procedimentos (TUSS)',
        blocking: true,
        responsibleRole: 'collaborator',
      },
      {
        key: 'opme_items',
        label: 'Itens OPME',
        blocking: true,
        responsibleRole: 'collaborator',
      },
      {
        key: 'medical_report',
        label: 'Laudo Médico',
        blocking: true,
        responsibleRole: 'doctor',
      },
    ],
  },
  {
    status: SurgeryRequestStatus.SENT,
    label: 'Enviada',
    pendencies: [],
  },
  {
    status: SurgeryRequestStatus.IN_ANALYSIS,
    label: 'Em Análise',
    pendencies: [],
  },
  {
    status: SurgeryRequestStatus.IN_SCHEDULING,
    label: 'Em Agendamento',
    pendencies: [
      {
        key: 'schedule_dates',
        label: 'Definir datas disponíveis',
        blocking: true,
        responsibleRole: 'collaborator',
      },
      {
        key: 'confirm_date',
        label: 'Paciente confirmar data',
        blocking: true,
        responsibleRole: 'patient',
      },
    ],
  },
  {
    status: SurgeryRequestStatus.SCHEDULED,
    label: 'Agendada',
    pendencies: [
      {
        key: 'surgery_expired',
        label: 'Data da cirurgia já passou',
        blocking: false, // apenas aviso
        responsibleRole: 'collaborator',
      },
    ],
  },
  {
    status: SurgeryRequestStatus.PERFORMED,
    label: 'Realizada',
    // Sem pendências de status — documentos pós-cirúrgicos são pré-requisito do endpoint /mark-performed
    pendencies: [],
  },
  {
    status: SurgeryRequestStatus.INVOICED,
    label: 'Faturada',
    pendencies: [
      {
        key: 'confirm_receipt',
        label: 'Confirmar recebimento',
        blocking: true,
        responsibleRole: 'collaborator',
      },
    ],
  },
  {
    status: SurgeryRequestStatus.FINALIZED,
    label: 'Finalizada',
    pendencies: [],
  },
  {
    status: SurgeryRequestStatus.CLOSED,
    label: 'Encerrada',
    pendencies: [],
  },
];

/**
 * Obtém a configuração de pendências para um status específico.
 */
export function getPendenciesForStatus(
  status: SurgeryRequestStatus,
): StatusPendenciesConfig | null {
  return PENDENCIES_CONFIG.find((c) => c.status === status) ?? null;
}
