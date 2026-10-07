import { existsSync, readdirSync } from 'fs';
import { extname, isAbsolute } from 'path';
import DOCUMENT_TYPES from 'src/common/document-types.common';
import { dataHoraCompleta, normalizarTexto } from '../../core/normalizers';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import { LEDGER_FICHA } from './clinical-record.mapper';
import { LEDGER_PACIENTE } from './patient.mapper';

export const LEDGER_DOCUMENTO = 'document';
/** Paciente do Feegow → paciente que recebeu a foto (o caminho fica no banco). */
export const LEDGER_FOTO = 'patient-photo';

/** Tipos aceitos no upload; foto de paciente só aceita imagem (MIG-01). */
const CONTENT_TYPE: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.webp': 'image/webp',
};
const IMAGEM = /^image\/(png|jpeg|webp)$/;

export interface ArquivoLocal {
  caminhoLocal: string;
  nome: string;
  contentType: string;
}

export interface NovoAnexo {
  id: string;
  patientId: string;
  clinicalRecordId: string | null;
  createdById: string;
  type: string;
  key: string;
  name: string;
  /** Preenchido depois do upload. */
  uri: string | null;
  createdAt: Date;
  updatedAt: Date;
  arquivo: ArquivoLocal;
}

export interface NovaFoto {
  patientId: string;
  /** Preenchido depois do upload. */
  photoPath: string | null;
  arquivo: ArquivoLocal;
}

/** Acesso ao disco, trocável nos testes. */
export interface Disco {
  existe(caminho: string): boolean;
  listar(pasta: string): string[];
}

export const discoReal: Disco = {
  existe: existsSync,
  listar: (pasta) => (existsSync(pasta) ? readdirSync(pasta) : []),
};

/**
 * Anexos do paciente (`arquivos` com `PacienteID ≠ 0`) e fotos de perfil
 * (`pacientes.foto` em `Client/Perfil`). Só planeja: o upload é da fase.
 */
export function planejarAnexos(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
  disco: Disco = discoReal,
): { documentos: NovoAnexo[]; fotos: NovaFoto[] } {
  const rel = ctx.relatorio;
  const documentos: NovoAnexo[] = [];

  for (const a of exp.tabela('arquivos')) {
    const idOrigem = a.id!;
    if (!a.PacienteID || a.PacienteID === '0') continue; // arquivo da clínica
    if (a.sysActive !== '1') continue;
    if (ctx.ledger.resolver(LEDGER_DOCUMENTO, idOrigem)) {
      rel.pular('anexo');
      continue;
    }
    const patientId = ctx.ledger.resolver(LEDGER_PACIENTE, a.PacienteID);
    if (!patientId) {
      rel.rejeitar('anexo', idOrigem, 'paciente não importado');
      continue;
    }
    const arquivo = arquivoLocal(exp, 'Arquivos', a.NomeArquivo, disco);
    if (typeof arquivo === 'string') {
      rel.rejeitar('anexo', idOrigem, arquivo);
      continue;
    }
    const criadoEm = dataHoraCompleta(a.DataHora) ?? new Date();
    const id = ctx.novoId();
    documentos.push({
      id,
      patientId,
      clinicalRecordId: ctx.ledger.resolver(
        LEDGER_FICHA,
        a.AtendimentoID ? `atd:${a.AtendimentoID}` : null,
      ),
      createdById: ctx.ownerId,
      type: DOCUMENT_TYPES.additionalDocument,
      key: `feegow_${idOrigem}`.slice(0, 50),
      name:
        normalizarTexto(a.Descricao, 75) ??
        normalizarTexto(a.NomeArquivo, 75) ??
        'Arquivo do Feegow',
      uri: null,
      createdAt: criadoEm,
      updatedAt: criadoEm,
      arquivo,
    });
    ctx.ledger.registrar(LEDGER_DOCUMENTO, idOrigem, id);
    rel.aceitar('anexo');
  }

  const fotos: NovaFoto[] = [];
  const referenciadas = new Set<string>();
  for (const p of exp.tabela('pacientes')) {
    if (!p.foto) continue;
    referenciadas.add(p.foto);
    if (ctx.ledger.resolver(LEDGER_FOTO, p.id)) {
      rel.pular('foto');
      continue;
    }
    const patientId = ctx.ledger.resolver(LEDGER_PACIENTE, p.id);
    if (!patientId) continue; // paciente excluído/rejeitado no cadastro
    const arquivo = arquivoLocal(exp, 'Perfil', p.foto, disco);
    if (typeof arquivo === 'string') {
      rel.rejeitar('foto', p.id!, arquivo);
      continue;
    }
    if (!IMAGEM.test(arquivo.contentType)) {
      rel.rejeitar(
        'foto',
        p.id!,
        `formato não aceito (${arquivo.contentType})`,
      );
      continue;
    }
    fotos.push({ patientId, photoPath: null, arquivo });
    ctx.ledger.registrar(LEDGER_FOTO, p.id!, patientId);
    rel.aceitar('foto');
  }

  const pastaPerfil = exp.arquivo('Perfil');
  const orfas = pastaPerfil
    ? disco.listar(pastaPerfil).filter((n) => !referenciadas.has(n)).length
    : 0;
  if (orfas) {
    rel.avisar(
      'foto',
      '-',
      `${orfas} arquivos em Client/Perfil sem paciente que os referencie (ignorados)`,
    );
  }
  return { documentos, fotos };
}

function arquivoLocal(
  exp: ExportFeegow,
  pasta: string,
  nome: string | null | undefined,
  disco: Disco,
): ArquivoLocal | string {
  if (!nome) return 'sem nome de arquivo';
  // `exp.arquivo` já recusa o que sai da pasta; aqui só dá o motivo certo.
  if (isAbsolute(nome) || nome.split(/[\\/]/).includes('..')) {
    return `nome de arquivo inválido, fora da pasta do export (${nome})`;
  }
  const caminhoLocal = exp.arquivo(pasta, nome);
  if (!caminhoLocal || !disco.existe(caminhoLocal)) {
    return `arquivo ausente no export (${pasta}/${nome})`;
  }
  const contentType = CONTENT_TYPE[extname(nome).toLowerCase()];
  if (!contentType) return `extensão não aceita (${extname(nome) || 'sem'})`;
  return { caminhoLocal, nome, contentType };
}
