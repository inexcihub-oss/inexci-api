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

/** `[Paciente.Nome]` → `{{paciente.nome}}`; marcador desconhecido fica literal. */
export function converterMarcadores(texto: string): string {
  return texto.replace(
    /\[([A-Za-zÀ-ú.]+)\]/g,
    (inteiro, nome: string) => PLACEHOLDERS[nome.toLowerCase()] ?? inteiro,
  );
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
      let body = converterMarcadores(htmlParaTexto(m[fonte.texto]));
      if (!body) {
        rel.rejeitar('modelo de documento', chave, 'modelo sem texto');
        continue;
      }
      if (body.length > CORPO_MAX) {
        rel.avisar(
          'modelo de documento',
          chave,
          `texto cortado em ${CORPO_MAX} caracteres`,
        );
        body = body.slice(0, CORPO_MAX);
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
