import { STORAGE_FOLDERS } from 'src/config/storage.config';

export const PASTAS_DE_AVATAR: readonly string[] = [STORAGE_FOLDERS.AVATARS];

export const PASTAS_DE_ASSINATURA: readonly string[] = [
  STORAGE_FOLDERS.SIGNATURES,
  STORAGE_FOLDERS.STAMPS,
];

export function ehArquivoDaConta(
  caminho: string | null | undefined,
  pastas: readonly string[],
  ownerId: string | null | undefined,
): boolean {
  if (!caminho || !ownerId) return false;
  if (caminho.includes('..') || caminho.includes('\\')) return false;
  return pastas.some((pasta) => {
    const prefixo = `${pasta}/${ownerId}/`;
    if (!caminho.startsWith(prefixo)) return false;
    const nome = caminho.slice(prefixo.length);
    return !!nome && !nome.includes('/');
  });
}
