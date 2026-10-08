import { ClinicalDocumentTemplateKind } from 'src/database/entities/clinical-document-template.entity';
import { htmlParaTexto } from '../../core/html';
import { normalizarTexto } from '../../core/normalizers';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import { profissionaisDoFeegow } from './team.mapper';

export const LEDGER_MODELO_DOCUMENTO = 'doc_template';

/** Mesmo limite do corpo do modelo na API (`DOCUMENT_TEMPLATE_BODY_MAX`). */
const CORPO_MAX = 2000;

/** Marcadores do Feegow → placeholders da INEXCI (MIG-06 §6). */
const PLACEHOLDERS: Record<string, string> = {
  'paciente.nome': '{{paciente.nome}}',
  'paciente.cpf': '{{paciente.cpf}}',
  'paciente.nascimento': '{{paciente.nascimento}}',
  'profissional.nome': '{{medico.nome}}',
  'profissional.crm': '{{medico.registro}}',
  'profissional.documento': '{{medico.registro}}',
  data: '{{data}}',
  'data.hoje': '{{data}}',
};

export interface NovoModeloDocumento {
  id: string;
  ownerId: string;
  doctorId: string;
  kind: ClinicalDocumentTemplateKind;
  name: string;
  body: string;
}

const MARCADOR = /\[([A-Za-zÀ-ú.]+)\]/g;

/** `[Paciente.Nome]` → `{{paciente.nome}}`; marcador desconhecido fica literal. */
export function converterMarcadores(texto: string): string {
  return texto.replace(
    MARCADOR,
    (inteiro, nome: string) => PLACEHOLDERS[nome.toLowerCase()] ?? inteiro,
  );
}

/**
 * Marcadores do Feegow sem equivalente na INEXCI, sem repetir — ficam como
 * texto literal no modelo e o cliente precisa saber disso. Conta só o que
 * tem a forma de marcador do Feegow (`[Entidade.Campo]`): palavra solta entre
 * colchetes (`[X]`, `[Obs]`) é texto do próprio modelo.
 */
export function marcadoresDesconhecidos(texto: string): string[] {
  const desconhecidos = new Set<string>();
  for (const [inteiro, nome] of texto.matchAll(MARCADOR)) {
    if (!nome.includes('.') || PLACEHOLDERS[nome.toLowerCase()]) continue;
    desconhecidos.add(inteiro);
  }
  return [...desconhecidos];
}

const FONTES = [
  {
    tabela: 'modelos_atestados',
    kind: ClinicalDocumentTemplateKind.MEDICAL_CERTIFICATE,
    nome: 'nome_modelo_atestado',
    texto: 'texto_modelo_atestado',
    padrao: 'Atestado (Feegow)',
    prefixo: 'atestado',
  },
  {
    tabela: 'modelos_pedidosexame',
    kind: ClinicalDocumentTemplateKind.EXAM_REFERRAL,
    nome: 'nome_modelo_pedido_exame',
    texto: 'texto_pedido_exame',
    padrao: 'Pedido de exame (Feegow)',
    prefixo: 'exame',
  },
] as const;

/**
 * Modelos de atestado e pedido de exame. O HTML do Feegow vira texto puro (o
 * modelo da INEXCI é texto, MIG-06 §8) com os marcadores convertidos. Dono do
 * modelo: o profissional que o criou, senão o dono da conta.
 */
export function planejarModelosDeDocumento(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): NovoModeloDocumento[] {
  const rel = ctx.relatorio;
  const profissionais = profissionaisDoFeegow(exp, ctx);
  const novos: NovoModeloDocumento[] = [];

  for (const fonte of FONTES) {
    for (const m of exp.tabela(fonte.tabela)) {
      const chave = `${fonte.prefixo}:${m.id}`;
      if (m.is_active !== '1') continue;
      if (ctx.ledger.resolver(LEDGER_MODELO_DOCUMENTO, chave)) {
        rel.pular('modelo de documento');
        continue;
      }
      const original = htmlParaTexto(m[fonte.texto]);
      let body = converterMarcadores(original);
      if (!body) {
        rel.rejeitar('modelo de documento', chave, 'modelo sem texto');
        continue;
      }
      const desconhecidos = marcadoresDesconhecidos(original);
      if (desconhecidos.length) {
        rel.avisar(
          'modelo de documento',
          chave,
          'marcadores do Feegow sem equivalente ficaram como texto: revise o modelo',
          desconhecidos.join(', '),
        );
      }
      if (body.length > CORPO_MAX) {
        rel.avisar(
          'modelo de documento',
          chave,
          `texto cortado em ${CORPO_MAX} caracteres`,
        );
        body = cortarSemPartirMarcador(body, CORPO_MAX);
      }
      const id = ctx.novoId();
      novos.push({
        id,
        ownerId: ctx.ownerId,
        doctorId: profissionais.get(m.usuario_insercao_id ?? '') ?? ctx.ownerId,
        kind: fonte.kind,
        name: normalizarTexto(m[fonte.nome], 100) ?? fonte.padrao,
        body,
      });
      ctx.ledger.registrar(LEDGER_MODELO_DOCUMENTO, chave, id);
      rel.aceitar('modelo de documento');
    }
  }
  return novos;
}

/**
 * Corta `texto` em `max` caracteres sem partir um marcador: se o corte cair
 * dentro de um `{{...}}`, recua até antes do `{{` aberto — senão o modelo
 * guardaria `{{paciente.no`, que nem é substituído nem some do documento.
 */
export function cortarSemPartirMarcador(texto: string, max: number): string {
  const cortado = texto.slice(0, max);
  const aberto = cortado.lastIndexOf('{{');
  if (aberto >= 0 && cortado.indexOf('}}', aberto) < 0) {
    return cortado.slice(0, aberto);
  }
  return cortado;
}
