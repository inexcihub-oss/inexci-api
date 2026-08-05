/**
 * Custo do bcrypt para novos hashes. Subir este numero nao reprotege senhas
 * ja existentes — o hash antigo permanece no custo em que foi gerado. Por isso
 * o login faz rehash oportunista via `precisaRehash`.
 */
export const BCRYPT_ROUNDS = 12;

/**
 * Detecta hash gerado com custo abaixo do atual. O formato bcrypt e
 * `$2b$<custo>$<salt+hash>`; um hash ilegivel devolve `true` para forcar a
 * regeneracao no proximo login bem-sucedido.
 */
export function precisaRehash(hash: string): boolean {
  const partes = (hash ?? '').split('$');
  if (partes.length < 4) return true;
  const custo = Number.parseInt(partes[2], 10);
  if (Number.isNaN(custo)) return true;
  return custo < BCRYPT_ROUNDS;
}
