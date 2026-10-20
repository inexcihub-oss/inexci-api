import { BadRequestException } from '@nestjs/common';
import {
  STORAGE_FOLDERS,
  STORAGE_FOLDER_SIZE_LIMITS,
} from '../../config/storage.config';

export const MIME_DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MIME_DOC = 'application/msword';

export const MIME_DOCUMENTOS_PERMITIDOS: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  MIME_DOC,
  MIME_DOCX,
];

export const PASTAS_DE_DOCUMENTO = [
  STORAGE_FOLDERS.DOCUMENTS,
  STORAGE_FOLDERS.POST_SURGICAL,
  STORAGE_FOLDERS.REPORT,
] as const;

export const MAX_DOCUMENTO_TAMANHO = Math.max(
  ...PASTAS_DE_DOCUMENTO.map((pasta) => STORAGE_FOLDER_SIZE_LIMITS[pasta]),
);

export const EXTENSAO_POR_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  [MIME_DOC]: 'doc',
  [MIME_DOCX]: 'docx',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

const MIME_EQUIVALENTE: Readonly<Record<string, string>> = {
  'image/jpg': 'image/jpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/x-wav': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
};

const DETECCAO_ACEITA_PARA: Readonly<Record<string, readonly string[]>> = {
  [MIME_DOC]: ['application/x-cfb'],
};

const MIME_GENERICOS = ['', 'application/octet-stream'];

export function mimeCanonico(mime: string | undefined | null): string {
  const normalizado = (mime ?? '').split(';')[0].trim().toLowerCase();
  return MIME_EQUIVALENTE[normalizado] ?? normalizado;
}

export interface ArquivoAValidar {
  mimetype?: string;
  buffer: Buffer;
}

export interface OpcoesValidacaoTipo {
  exigeDeteccao?: (mime: string) => boolean;
}

export interface TipoValidado {
  mime: string;
  ext: string | undefined;
}

function detectadoCorresponde(declarado: string, detectado: string): boolean {
  return (
    declarado === detectado ||
    (DETECCAO_ACEITA_PARA[declarado] ?? []).includes(detectado)
  );
}

function mimeDoDetectado(
  detectado: string,
  permitidos: readonly string[],
): string | undefined {
  if (permitidos.includes(detectado)) return detectado;
  return permitidos.find((mime) =>
    (DETECCAO_ACEITA_PARA[mime] ?? []).includes(detectado),
  );
}

export async function validarTipoArquivo(
  arquivo: ArquivoAValidar,
  permitidos: readonly string[],
  opcoes: OpcoesValidacaoTipo = {},
): Promise<TipoValidado> {
  const exigeDeteccao = opcoes.exigeDeteccao ?? (() => true);
  const permitidosCanonicos = permitidos.map(mimeCanonico);
  const declarado = mimeCanonico(arquivo.mimetype);
  const generico = MIME_GENERICOS.includes(declarado);

  if (!generico && !permitidosCanonicos.includes(declarado)) {
    throw new BadRequestException(
      `Tipo de arquivo não permitido: ${arquivo.mimetype}`,
    );
  }

  const { fileTypeFromBuffer } = await import('file-type');
  const resultado = await fileTypeFromBuffer(arquivo.buffer);
  const detectado = resultado ? mimeCanonico(resultado.mime) : undefined;

  let mime: string | undefined;
  if (generico) {
    mime = detectado
      ? mimeDoDetectado(detectado, permitidosCanonicos)
      : undefined;
  } else if (detectado) {
    mime = detectadoCorresponde(declarado, detectado) ? declarado : undefined;
  } else if (!exigeDeteccao(declarado)) {
    mime = declarado;
  }

  if (!mime) {
    throw new BadRequestException('Tipo de arquivo inválido');
  }

  return { mime, ext: EXTENSAO_POR_MIME[mime] };
}

export function nomeComExtensao(nome: string, ext: string | undefined): string {
  if (!ext) return nome;
  const base = (nome || 'arquivo').replace(/\.[^./\\]*$/, '') || 'arquivo';
  return `${base}.${ext}`;
}

export async function prepararDocumentoParaUpload<
  T extends { originalname: string; mimetype: string; buffer: Buffer },
>(arquivo: T): Promise<T> {
  const { mime, ext } = await validarTipoArquivo(
    arquivo,
    MIME_DOCUMENTOS_PERMITIDOS,
  );
  return {
    ...arquivo,
    mimetype: mime,
    originalname: nomeComExtensao(arquivo.originalname, ext),
  };
}

const MIME_SEGUROS_PARA_ARMAZENAR = new Set<string>(
  Object.keys(EXTENSAO_POR_MIME),
);

export function contentTypeSeguro(mime: string | undefined | null): string {
  const canonico = mimeCanonico(mime);
  return MIME_SEGUROS_PARA_ARMAZENAR.has(canonico)
    ? canonico
    : 'application/octet-stream';
}

const TIPO_EXIBIVEL_POR_EXTENSAO: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

const TIPO_PARA_BAIXAR_POR_EXTENSAO: Readonly<Record<string, string>> = {
  doc: MIME_DOC,
  docx: MIME_DOCX,
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export interface CabecalhosDeResposta {
  ResponseContentType?: string;
  ResponseContentDisposition?: string;
}

export function cabecalhosDeRespostaPorCaminho(
  caminho: string,
): CabecalhosDeResposta {
  const nomeArquivo = caminho.split('/').pop() ?? '';
  const ponto = nomeArquivo.lastIndexOf('.');
  const ext =
    ponto > 0 ? nomeArquivo.slice(ponto + 1).toLowerCase() : undefined;

  const exibivel = ext ? TIPO_EXIBIVEL_POR_EXTENSAO[ext] : undefined;
  if (exibivel) {
    return { ResponseContentType: exibivel };
  }

  const nomeSeguro =
    nomeArquivo.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150) || 'arquivo';
  const disposicao = `attachment; filename="${nomeSeguro}"`;
  if (!ext) {
    return { ResponseContentDisposition: disposicao };
  }
  return {
    ResponseContentType:
      TIPO_PARA_BAIXAR_POR_EXTENSAO[ext] ?? 'application/octet-stream',
    ResponseContentDisposition: disposicao,
  };
}
