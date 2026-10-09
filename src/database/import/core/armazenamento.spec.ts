import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  apagarEmLotes,
  ArmazenamentoImportacao,
  comRegistroDeOrfaos,
  emParalelo,
  limparEPropagar,
} from './armazenamento';

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

describe('apagarEmLotes', () => {
  it('divide em lotes e acumula as chaves que falharam', async () => {
    const lotes: string[][] = [];
    const falhas = await apagarEmLotes(
      ['a', 'b', 'c', 'd', 'e'],
      async (lote) => {
        lotes.push(lote);
        return lote.filter((k) => k === 'b' || k === 'e');
      },
      2,
    );
    expect(lotes).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    expect(falhas).toEqual(['b', 'e']);
  });

  it('lote que lança conta inteiro como falha e os seguintes seguem', async () => {
    const falhas = await apagarEmLotes(
      ['a', 'b', 'c'],
      async (lote) => {
        if (lote.includes('a')) throw new Error('rede');
        return [];
      },
      2,
    );
    expect(falhas).toEqual(['a', 'b']);
  });
});

describe('comRegistroDeOrfaos', () => {
  let out: string;
  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'orfaos-'));
  });
  afterEach(() => rmSync(out, { recursive: true, force: true }));

  const base = (falhas: string[] | Error): ArmazenamentoImportacao => ({
    enviar: jest.fn(),
    apagar: jest.fn(async () => {
      if (falhas instanceof Error) throw falhas;
      return falhas;
    }),
  });

  it('tudo apagado: não grava arquivo nem loga', async () => {
    const log = jest.fn();
    const arm = comRegistroDeOrfaos(base([]), { out, fase: 'anexos' }, log);
    await expect(arm.apagar(['a', 'b'])).resolves.toEqual([]);
    expect(existsSync(join(out, 'orfaos-anexos.json'))).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it('falha parcial: loga as chaves e soma em orfaos-<fase>.json', async () => {
    const log = jest.fn();
    const arm = comRegistroDeOrfaos(base(['b']), { out, fase: 'anexos' }, log);
    await expect(arm.apagar(['a', 'b'])).resolves.toEqual(['b']);
    const arm2 = comRegistroDeOrfaos(
      base(['c', 'b']),
      { out, fase: 'anexos' },
      log,
    );
    await arm2.apagar(['c', 'b']);

    const arquivo = JSON.parse(
      readFileSync(join(out, 'orfaos-anexos.json'), 'utf8'),
    );
    expect(arquivo.fase).toBe('anexos');
    expect(arquivo.chaves).toEqual(['b', 'c']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('1 de 2'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining(': b'));
  });

  it('apagar que lança vira tudo órfão, sem propagar', async () => {
    const log = jest.fn();
    const arm = comRegistroDeOrfaos(
      base(new Error('sem rede')),
      { out, fase: 'anexos' },
      log,
    );
    await expect(arm.apagar(['a'])).resolves.toEqual(['a']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('sem rede'));
    expect(
      JSON.parse(readFileSync(join(out, 'orfaos-anexos.json'), 'utf8')).chaves,
    ).toEqual(['a']);
  });
});

describe('limparEPropagar', () => {
  it('relança o erro original depois de limpar', async () => {
    const limpeza = jest.fn().mockResolvedValue(undefined);
    const original = new Error('insert falhou');
    await expect(limparEPropagar(original, limpeza, jest.fn())).rejects.toBe(
      original,
    );
    expect(limpeza).toHaveBeenCalled();
  });

  it('limpeza que lança é logada e não esconde o erro original', async () => {
    const log = jest.fn();
    const original = new Error('insert falhou');
    await expect(
      limparEPropagar(
        original,
        async () => {
          throw new Error('R2 fora');
        },
        log,
      ),
    ).rejects.toBe(original);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('R2 fora'));
  });
});
