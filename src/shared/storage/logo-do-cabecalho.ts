import { STORAGE_FOLDERS } from '../../config/storage.config';

const SUFIXO_R2 = '.r2.cloudflarestorage.com';

export function chaveDaUrlDoBucket(
  url: string,
  bucket: string | null | undefined,
): string | null {
  if (!bucket) return null;
  let alvo: URL;
  try {
    alvo = new URL(url);
  } catch {
    return null;
  }
  if (alvo.protocol !== 'https:' || !alvo.hostname.endsWith(SUFIXO_R2)) {
    return null;
  }

  let caminho: string;
  try {
    caminho = decodeURIComponent(alvo.pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }

  if (alvo.hostname.startsWith(`${bucket}.`)) return caminho || null;
  const prefixo = `${bucket}/`;
  if (!caminho.startsWith(prefixo)) return null;
  return caminho.slice(prefixo.length) || null;
}

export function caminhoDoLogoDoCabecalho(
  logoUrl: string | null | undefined,
  opcoes: { bucket?: string | null; ownerId?: string | null },
): string | null {
  if (!logoUrl) return null;
  const chave = /^https?:\/\//i.test(logoUrl)
    ? chaveDaUrlDoBucket(logoUrl, opcoes.bucket)
    : logoUrl;
  if (!chave || chave.includes('..') || chave.includes('\\')) return null;

  const prefixo = opcoes.ownerId
    ? `${STORAGE_FOLDERS.HEADERS}/${opcoes.ownerId}/`
    : `${STORAGE_FOLDERS.HEADERS}/`;
  if (!chave.startsWith(prefixo) || chave.length === prefixo.length) {
    return null;
  }
  return chave;
}
