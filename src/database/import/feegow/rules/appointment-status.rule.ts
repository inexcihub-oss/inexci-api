import { AppointmentStatus } from 'src/database/entities/appointment.entity';

/** `agendamento_status` do Feegow → status da INEXCI. */
const STATUS_FEEGOW: Record<string, AppointmentStatus> = {
  '1': AppointmentStatus.SCHEDULED, // Marcado - não confirmado
  '7': AppointmentStatus.CONFIRMED, // Marcado - confirmado
  '208': AppointmentStatus.CONFIRMED, // Aguardando pagamento
  '4': AppointmentStatus.WAITING, // Aguardando (chegou na recepção)
  '5': AppointmentStatus.WAITING, // Chamando
  '2': AppointmentStatus.IN_PROGRESS, // Em atendimento
  '3': AppointmentStatus.COMPLETED, // Atendido
  '6': AppointmentStatus.NO_SHOW, // Não compareceu
  '11': AppointmentStatus.CANCELLED, // Desmarcado pelo paciente
  '22': AppointmentStatus.CANCELLED, // Cancelado pelo profissional
  '15': AppointmentStatus.CANCELLED, // Remarcado (o horário antigo)
};

/** Status que, no Feegow, ainda estavam "em aberto". */
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

/**
 * Status da consulta importada.
 *
 * - Mapa direto do Feegow, mantendo "aguardando" e "em atendimento".
 * - Consulta em aberto **com atendimento registrado** vira realizada: o
 *   atendimento aconteceu, só o status do Feegow não foi fechado.
 * - Consulta passada em aberto **sem** atendimento: mantém, salvo
 *   `--passadas-sem-atendimento`.
 * - Cancelada leva o nome do status do Feegow como motivo.
 *
 * `null` = status desconhecido (a consulta é rejeitada com o id do status).
 */
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
