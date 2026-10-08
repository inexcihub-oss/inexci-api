import { AppointmentStatus } from 'src/database/entities/appointment.entity';
import { AppointmentActivityType } from 'src/database/entities/appointment-activity.entity';
import { decodificarEntidadesHtml } from '../../core/normalizers';
import { statusDoFeegow } from './appointment-status.rule';

/** Uma linha de `log_marcacoes`, já com a data convertida. */
export interface EventoDoLog {
  /** `A` agendado, `R` alteração, `X` exclusão. */
  arx: string | null;
  statusId: string | null;
  obs: string | null;
  motivo: string | null;
  quando: Date;
  autorId: string | null;
}

export interface AtividadeDoLog {
  type: AppointmentActivityType;
  fromStatus: AppointmentStatus | null;
  toStatus: AppointmentStatus | null;
  content: string | null;
  createdAt: Date;
  userId: string | null;
}

/** Texto que o Feegow grava sozinho ao trocar o status: não informa nada. */
const TEXTO_PADRAO = /^altera[çc][ãa]o de status\.?$/i;
const STATUS_REMARCADO = '15';
const INICIADO = /^atendimento iniciado/i;
const FINALIZADO = /^atendimento finalizado/i;
const REMARCADO = /^(remarcado|altera[çc][ãa]o de hor[áa]rio)/i;

/**
 * Linha do tempo de uma consulta a partir dos eventos do Feegow, já em ordem
 * cronológica (MIG-04 §6).
 *
 * - `A` → `created` (o texto é a observação digitada ao agendar).
 * - "Remarcado…" / "Alteração de horário…" ou o status 15 ("Remarcado"),
 *   com qualquer texto → `rescheduled`; o 15 nunca muda o status da linha
 *   do tempo.
 * - "Atendimento iniciado…" → em atendimento; "Atendimento finalizado" →
 *   realizada.
 * - Demais `R`: `status_change` quando o status mudou; senão `updated`, ou
 *   nada se não houver texto (o "Alteração de status" automático não conta).
 * - `X` fica de fora: consulta excluída não é importada.
 * - `motivo` ≠ 0 vai no fim do texto: o export não traz a tabela de motivos.
 */
export function atividadesDoLog(eventos: EventoDoLog[]): AtividadeDoLog[] {
  const atividades: AtividadeDoLog[] = [];
  let atual: AppointmentStatus | null = null;

  for (const e of eventos) {
    if (e.arx !== 'A' && e.arx !== 'R') continue;
    const obs = textoDoEvento(e.obs);
    const comMotivo = (texto: string | null) => {
      const motivo = (e.motivo ?? '').trim();
      if (!motivo || motivo === '0') return texto;
      const sufixo = `(motivo Feegow ${motivo})`;
      return texto ? `${texto} ${sufixo}` : sufixo;
    };
    const base = {
      createdAt: e.quando,
      userId: e.autorId,
    };

    if (e.arx === 'A') {
      const status = statusDoFeegow(e.statusId) ?? AppointmentStatus.SCHEDULED;
      atividades.push({
        ...base,
        type: AppointmentActivityType.CREATED,
        fromStatus: null,
        toStatus: status,
        content: comMotivo(obs),
      });
      atual = status;
      continue;
    }

    let novo: AppointmentStatus | null = statusDoFeegow(e.statusId) ?? atual;
    let type: AppointmentActivityType;
    let content = obs;
    if (obs && INICIADO.test(obs)) {
      novo = AppointmentStatus.IN_PROGRESS;
      type = AppointmentActivityType.STATUS_CHANGE;
    } else if (obs && FINALIZADO.test(obs)) {
      novo = AppointmentStatus.COMPLETED;
      type = AppointmentActivityType.STATUS_CHANGE;
    } else if (
      e.statusId === STATUS_REMARCADO ||
      (obs && REMARCADO.test(obs))
    ) {
      type = AppointmentActivityType.RESCHEDULED;
      // O 15 ("Remarcado") é uma marca de passagem no Feegow: a mesma
      // consulta segue para confirmada/aguardando depois. Tratar como
      // cancelamento criaria "Cancelada → Confirmada" falsos na linha do tempo
      // — vale para qualquer texto (ou nenhum) que acompanhe o 15.
      if (e.statusId === STATUS_REMARCADO) novo = atual;
      // "Remarcado - " sem justificativa.
      content = obs ? obs.replace(/\s*-\s*$/, '') : null;
    } else if (novo !== atual) {
      type = AppointmentActivityType.STATUS_CHANGE;
    } else {
      type = AppointmentActivityType.UPDATED;
    }

    if (content && TEXTO_PADRAO.test(content)) content = null;
    content = comMotivo(content);
    const mudou = novo !== atual;
    if (type === AppointmentActivityType.UPDATED && !content) continue;

    atividades.push({
      ...base,
      type,
      fromStatus: mudou ? atual : null,
      toStatus: mudou ? novo : null,
      content,
    });
    atual = novo;
  }
  return atividades;
}

function textoDoEvento(obs: string | null): string | null {
  const texto = decodificarEntidadesHtml(obs ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return texto || null;
}
