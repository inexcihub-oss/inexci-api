import { LinhaCsv } from '../../core/csv';
import { dataHoraCompleta } from '../../core/normalizers';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import { AtividadeDoLog, atividadesDoLog } from '../rules/activity.rule';
import { LEDGER_CONSULTA } from './appointment.mapper';
import { autoresDoFeegow } from './team.mapper';

export const LEDGER_HISTORICO = 'appointment-history';

export interface NovaAtividade extends AtividadeDoLog {
  id: string;
  appointmentId: string;
}

export function planejarHistorico(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): NovaAtividade[] {
  const rel = ctx.relatorio;
  const autores = autoresDoFeegow(exp, ctx);

  const porAgendamento = new Map<string, LinhaCsv[]>();
  for (const l of exp.tabela('log_marcacoes')) {
    const ag = l.agendamento_id ?? '';
    const lista = porAgendamento.get(ag) ?? [];
    lista.push(l);
    porAgendamento.set(ag, lista);
  }

  const novas: NovaAtividade[] = [];
  let semConsulta = 0;
  for (const [agendamento, linhas] of porAgendamento) {
    const appointmentId = ctx.ledger.resolver(LEDGER_CONSULTA, agendamento);
    if (!appointmentId) {
      semConsulta += linhas.length;
      continue;
    }
    if (ctx.ledger.resolver(LEDGER_HISTORICO, agendamento)) {
      rel.pular('historico');
      continue;
    }

    const eventos = [];
    for (const l of linhas) {
      const quando = dataHoraCompleta(l.data_hora);
      if (!quando) {
        rel.rejeitar('atividade', l.id ?? '-', 'data_hora inválida');
        continue;
      }
      eventos.push({
        arx: l.arx,
        statusId: l.status_id,
        obs: l.obs,
        motivo: l.motivo,
        quando,
        autorId: autores.get(l.usuario ?? '') ?? null,
        ordem: Number(l.id) || 0,
      });
    }
    eventos.sort(
      (a, b) => a.quando.getTime() - b.quando.getTime() || a.ordem - b.ordem,
    );

    const atividades = atividadesDoLog(eventos);
    if (!atividades.length) continue;
    for (const a of atividades) {
      novas.push({ ...a, id: ctx.novoId(), appointmentId });
    }
    rel.aceitar('atividade', atividades.length);
    ctx.ledger.registrar(LEDGER_HISTORICO, agendamento, appointmentId);
  }

  if (semConsulta) {
    rel.avisar(
      'atividade',
      '-',
      `${semConsulta} eventos de consultas não importadas (excluídas ou rejeitadas na fase agenda) ficaram de fora`,
    );
  }
  return novas;
}
