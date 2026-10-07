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

  it('na primeira falha não começa item novo e espera os que estavam em andamento', async () => {
    const terminados: number[] = [];
    const iniciados: number[] = [];
    await expect(
      emParalelo([1, 2, 3, 4, 5, 6], 3, async (n) => {
        iniciados.push(n);
        if (n === 1) throw new Error('falhou');
        await new Promise((r) => setTimeout(r, 20));
        terminados.push(n);
      }),
    ).rejects.toThrow('falhou');
    // 2 e 3 já estavam em voo: terminaram antes da rejeição.
    expect(terminados.sort()).toEqual([2, 3]);
    expect(iniciados.sort()).toEqual([1, 2, 3]);
  });

  it('rejeita com o primeiro erro', async () => {
    await expect(
      emParalelo([1, 2], 2, async (n) => {
        await new Promise((r) => setTimeout(r, n === 1 ? 1 : 10));
        throw new Error(`erro ${n}`);
      }),
    ).rejects.toThrow('erro 1');
  });
});
