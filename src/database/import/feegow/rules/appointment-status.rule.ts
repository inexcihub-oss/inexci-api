import { AppointmentStatus } from 'src/database/entities/appointment.entity';

const STATUS_FEEGOW: Record<string, AppointmentStatus> = {
  '1': AppointmentStatus.SCHEDULED,
  '7': AppointmentStatus.CONFIRMED,
  '208': AppointmentStatus.CONFIRMED,
  '4': AppointmentStatus.WAITING,
  '5': AppointmentStatus.WAITING,
  '2': AppointmentStatus.IN_PROGRESS,
  '3': AppointmentStatus.COMPLETED,
  '6': AppointmentStatus.NO_SHOW,
  '11': AppointmentStatus.CANCELLED,
  '22': AppointmentStatus.CANCELLED,
  '15': AppointmentStatus.CANCELLED,
};

export function statusDoFeegow(
  statusId: string | null | undefined,
): AppointmentStatus | null {
  return STATUS_FEEGOW[statusId ?? ''] ?? null;
}

const EM_ABERTO = new Set<AppointmentStatus>([
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.WAITING,
  AppointmentStatus.IN_PROGRESS,
]);

export interface StatusImportado {
  status: AppointmentStatus;
  cancellationReason: string | null;
}

export function statusDaConsulta(params: {
  statusId: string | null;
  nomeDoStatus: string | null;
  temAtendimento: boolean;
  passada: boolean;
  passadasSemAtendimento: 'manter' | 'completed' | 'no_show';
}): StatusImportado | null {
  const base = STATUS_FEEGOW[params.statusId ?? ''];
  if (!base) return null;

  if (EM_ABERTO.has(base)) {
    if (params.temAtendimento) {
      return { status: AppointmentStatus.COMPLETED, cancellationReason: null };
    }
    if (params.passada && params.passadasSemAtendimento !== 'manter') {
      return {
        status:
          params.passadasSemAtendimento === 'completed'
            ? AppointmentStatus.COMPLETED
            : AppointmentStatus.NO_SHOW,
        cancellationReason: null,
      };
    }
  }

  return {
    status: base,
    cancellationReason:
      base === AppointmentStatus.CANCELLED
        ? (params.nomeDoStatus ?? 'Cancelada no Feegow')
        : null,
  };
}
