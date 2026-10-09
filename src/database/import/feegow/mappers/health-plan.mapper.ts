import { normalizarTexto } from '../../core/normalizers';
import { chaveDeNome, ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import { CONVENIOS_QUE_SAO_TIPO_DE_CONSULTA } from '../regras-do-cliente';

export { CONVENIOS_QUE_SAO_TIPO_DE_CONSULTA };

export const LEDGER_CONVENIO = 'health_plan';

export interface NovoConvenio {
  id: string;
  ownerId: string;
  name: string;
  active: boolean;
}

export function planejarConvenios(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): NovoConvenio[] {
  const usados = new Set<string>();
  for (const a of exp.tabela('agendamentos')) {
    if (a.sys_active === '1' && a.convenio_id) usados.add(a.convenio_id);
  }
  for (const pc of exp.tabela('paciente_convenio')) {
    for (const k of ['convenio_id1', 'convenio_id2', 'convenio_id3']) {
      if (pc[k]) usados.add(pc[k]!);
    }
  }

  const novos: NovoConvenio[] = [];
  const porNome = new Map(ctx.conveniosExistentes);

  for (const c of exp.tabela('convenios')) {
    const idOrigem = c.id!;
    if (!usados.has(idOrigem) || idOrigem === '0') continue;
    if (CONVENIOS_QUE_SAO_TIPO_DE_CONSULTA.has(idOrigem)) continue;
    if (ctx.ledger.resolver(LEDGER_CONVENIO, idOrigem)) {
      ctx.relatorio.pular('convênio');
      continue;
    }
    const nome = normalizarTexto(c.nome, 150);
    if (!nome) {
      ctx.relatorio.rejeitar('convênio', idOrigem, 'sem nome');
      continue;
    }
    const chave = chaveDeNome(nome);
    const existente = porNome.get(chave);
    if (existente) {
      ctx.ledger.registrar(LEDGER_CONVENIO, idOrigem, existente);
      ctx.relatorio.aceitar('convênio (reaproveitado pelo nome)');
      continue;
    }
    const id = ctx.novoId();
    novos.push({ id, ownerId: ctx.ownerId, name: nome, active: true });
    porNome.set(chave, id);
    ctx.ledger.registrar(LEDGER_CONVENIO, idOrigem, id);
    ctx.relatorio.aceitar('convênio');
  }
  return novos;
}
