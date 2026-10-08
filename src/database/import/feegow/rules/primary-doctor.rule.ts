import { LinhaCsv } from '../../core/csv';

/**
 * O Feegow não tem "médico responsável" no paciente; a INEXCI exige
 * (`patients.doctor_id`). Deriva do histórico: o profissional com mais
 * consultas ativas do paciente; empate → o da consulta mais recente.
 *
 * Devolve os ids de profissional do Feegow em ordem de preferência, para o
 * chamador pular quem não foi importado. Vazio = paciente sem consulta.
 */
export function profissionaisPorPaciente(
  agendamentos: LinhaCsv[],
): Map<string, string[]> {
  const porPaciente = new Map<
    string,
    Map<string, { total: number; ultima: string }>
  >();

  for (const a of agendamentos) {
    if (a.sys_active !== '1' || !a.paciente_id || !a.profissional_id) continue;
    const contagem = porPaciente.get(a.paciente_id) ?? new Map();
    const atual = contagem.get(a.profissional_id) ?? { total: 0, ultima: '' };
    atual.total += 1;
    const quando = `${a.Data ?? ''} ${a.Hora ?? ''}`;
    if (quando > atual.ultima) atual.ultima = quando;
    contagem.set(a.profissional_id, atual);
    porPaciente.set(a.paciente_id, contagem);
  }

  const resultado = new Map<string, string[]>();
  for (const [paciente, contagem] of porPaciente) {
    resultado.set(
      paciente,
      [...contagem.entries()]
        .sort(
          ([, a], [, b]) =>
            b.total - a.total || b.ultima.localeCompare(a.ultima),
        )
        .map(([prof]) => prof),
    );
  }
  return resultado;
}
