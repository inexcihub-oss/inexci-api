import * as bcrypt from 'bcryptjs';
import { BCRYPT_ROUNDS, precisaRehash } from '../../shared/constants/bcrypt';

describe('Rehash oportunista do bcrypt', () => {
  it('usa 12 rounds como padrao', () => {
    expect(BCRYPT_ROUNDS).toBe(12);
  });

  it('detecta hash antigo com custo menor', async () => {
    const hashAntigo = await bcrypt.hash('SenhaForte123@', 10);
    expect(precisaRehash(hashAntigo)).toBe(true);
  });

  it('nao pede rehash de hash ja no custo atual', async () => {
    const hashAtual = await bcrypt.hash('SenhaForte123@', BCRYPT_ROUNDS);
    expect(precisaRehash(hashAtual)).toBe(false);
  }, 15000);

  it('pede rehash quando o hash e ilegivel', () => {
    expect(precisaRehash('nao-e-um-hash-bcrypt')).toBe(true);
  });
});
