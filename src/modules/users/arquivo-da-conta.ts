import { STORAGE_FOLDERS } from 'src/config/storage.config';

/** Pastas em que o avatar de usuário pode morar. */
export const PASTAS_DE_AVATAR: readonly string[] = [STORAGE_FOLDERS.AVATARS];

/** Pastas em que a assinatura (ou o carimbo) do profissional pode morar. */
export const PASTAS_DE_ASSINATURA: readonly string[] = [
  STORAGE_FOLDERS.SIGNATURES,
  STORAGE_FOLDERS.STAMPS,
];

/**
 * O caminho é um arquivo que a conta `ownerId` enviou para uma destas pastas?
 *
 * É o formato que o `UploadService.uploadFile` grava:
 * `<pasta>/<ownerId>/<uuid>-<nome>` — direto na pasta da conta, sem subpasta.
 * Recusa `..`, barra invertida, subpasta, URL e caminho de outra conta.
 *
 * Existe porque avatar e assinatura são caminhos que o próprio cliente manda
 * de volta depois do upload. Sem a checagem, o caminho podia apontar para
 * qualquer objeto do bucket: a foto de um paciente (`patient-photos/...`), que
 * o backend então assinava como "avatar" — ou apagava, ao trocar o avatar.
 */
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
