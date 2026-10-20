import { STORAGE_FOLDERS } from 'src/config/storage.config';

export interface AtividadePdfLida {
  description?: string;
  contestationId?: string;
  pdfPath: string | null;
  motivoRejeicao?: 'autor_nao_sistema' | 'caminho_fora_do_tenant';
}

export function caminhoPdfDoTenant(
  caminho: unknown,
  ownerId: string | null | undefined,
): string | null {
  if (typeof caminho !== 'string' || !caminho || !ownerId) return null;
  const prefixo = `${STORAGE_FOLDERS.PDFS}/${ownerId}/`;
  if (!caminho.startsWith(prefixo)) return null;
  const resto = caminho.slice(prefixo.length);
  if (!resto || resto.includes('/') || resto.includes('\\')) return null;
  if (resto.includes('..')) return null;
  return caminho;
}

export function lerAtividadePdf(
  atividade: { userId?: string | null; content: string },
  ownerId: string | null | undefined,
): AtividadePdfLida | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(atividade.content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const dados = parsed as Record<string, unknown>;
  const lida: AtividadePdfLida = {
    description:
      typeof dados.description === 'string' ? dados.description : undefined,
    contestationId:
      typeof dados.contestation_id === 'string'
        ? dados.contestation_id
        : undefined,
    pdfPath: null,
  };

  if (dados.pdf_path === undefined || dados.pdf_path === null) return lida;

  if (atividade.userId) {
    lida.motivoRejeicao = 'autor_nao_sistema';
    return lida;
  }

  const caminho = caminhoPdfDoTenant(dados.pdf_path, ownerId);
  if (!caminho) {
    lida.motivoRejeicao = 'caminho_fora_do_tenant';
    return lida;
  }

  lida.pdfPath = caminho;
  return lida;
}
