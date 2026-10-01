import { emParalelo } from './armazenamento';

describe('emParalelo', () => {
  it('processa todos os itens sem passar do limite simultâneo', async () => {
    let ativos = 0;
    let pico = 0;
    const feitos: number[] = [];
    await emParalelo([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      ativos++;
      pico = Math.max(pico, ativos);
      await new Promise((r) => setTimeout(r, 1));
      feitos.push(n);
      ativos--;
    });
    expect(feitos.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pico).toBe(3);
  });

  it('lista vazia não faz nada; erro propaga', async () => {
    await expect(
      emParalelo([], 2, async () => undefined),
    ).resolves.toBeUndefined();
    await expect(
      emParalelo([1], 2, async () => {
        throw new Error('falhou');
      }),
    ).rejects.toThrow('falhou');
  });
});
