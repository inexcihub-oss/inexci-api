export const BCRYPT_ROUNDS = 12;

export function precisaRehash(hash: string): boolean {
  const partes = (hash ?? '').split('$');
  if (partes.length < 4) return true;
  const custo = Number.parseInt(partes[2], 10);
  if (Number.isNaN(custo)) return true;
  return custo < BCRYPT_ROUNDS;
}
