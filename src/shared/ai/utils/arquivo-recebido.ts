import { BadRequestException } from '@nestjs/common';
import { validarTipoArquivo } from '../../storage/tipo-arquivo';

export const MIME_IMAGENS_RECEBIDAS: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

export const MIME_DOCUMENTOS_RECEBIDOS: readonly string[] = [
  ...MIME_IMAGENS_RECEBIDAS,
  'application/pdf',
];

const EXTENSOES_CONHECIDAS = /\.(jpe?g|png|webp|gif|pdf|docx?)$/i;

export class ArquivoRecebidoInvalidoError extends Error {}

export interface ArquivoRecebidoTipado {
  mime: string;
  ext: string;
  nome: string;
}

export function garantirExtensao(nome: string, ext: string): string {
  const base =
    (nome || '').trim().replace(EXTENSOES_CONHECIDAS, '').trim() || 'arquivo';
  return `${base}.${ext}`;
}

export async function tiparArquivoRecebido(
  buffer: Buffer,
  nome: string,
  permitidos: readonly string[],
): Promise<ArquivoRecebidoTipado> {
  let tipo: { mime: string; ext: string | undefined };
  try {
    tipo = await validarTipoArquivo({ buffer }, permitidos);
  } catch (err) {
    if (err instanceof BadRequestException) {
      throw new ArquivoRecebidoInvalidoError(
        'Conteúdo do arquivo não corresponde a um tipo permitido.',
      );
    }
    throw err;
  }
  if (!tipo.ext) {
    throw new ArquivoRecebidoInvalidoError(
      'Conteúdo do arquivo não corresponde a um tipo permitido.',
    );
  }
  return {
    mime: tipo.mime,
    ext: tipo.ext,
    nome: garantirExtensao(nome, tipo.ext),
  };
}
