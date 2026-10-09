import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface ArmazenamentoImportacao {
  enviar(arquivo: {
    conteudo: Buffer;
    pasta: string;
    nome: string;
    contentType: string;
    tenantId: string;
  }): Promise<string>;
  apagar(caminhos: string[]): Promise<string[]>;
}

export const CHAVES_POR_DELETE = 1000;

export async function apagarEmLotes(
  caminhos: string[],
  apagarLote: (lote: string[]) => Promise<string[]>,
  tamanho = CHAVES_POR_DELETE,
): Promise<string[]> {
  const falhas: string[] = [];
  for (let i = 0; i < caminhos.length; i += tamanho) {
    const lote = caminhos.slice(i, i + tamanho);
    try {
      falhas.push(...(await apagarLote(lote)));
    } catch {
      falhas.push(...lote);
    }
  }
  return falhas;
}

export function registrarOrfaos(
  out: string,
  fase: string,
  chaves: string[],
): string {
  mkdirSync(out, { recursive: true });
  const caminho = join(out, `orfaos-${fase}.json`);
  let anteriores: string[] = [];
  if (existsSync(caminho)) {
    try {
      const lido = JSON.parse(readFileSync(caminho, 'utf8'));
      if (Array.isArray(lido?.chaves)) anteriores = lido.chaves;
    } catch {}
  }
  const todas = [...new Set([...anteriores, ...chaves])];
  writeFileSync(
    caminho,
    JSON.stringify(
      {
        fase,
        atualizadoEm: new Date().toISOString(),
        instrucao:
          'Arquivos enviados ao R2 que não puderam ser apagados e não têm registro no banco: apague-os manualmente.',
        chaves: todas,
      },
      null,
      2,
    ),
  );
  return caminho;
}

export function comRegistroDeOrfaos(
  base: ArmazenamentoImportacao,
  destino: { out: string; fase: string },
  log: (mensagem: string) => void = console.error,
): ArmazenamentoImportacao {
  return {
    enviar: (arquivo) => base.enviar(arquivo),
    apagar: async (caminhos) => {
      let falhas: string[];
      try {
        falhas = await base.apagar(caminhos);
      } catch (erro) {
        log(
          `  aviso: falha ao apagar arquivos do R2 (${(erro as Error).message})`,
        );
        falhas = [...caminhos];
      }
      if (falhas.length) {
        const arquivo = registrarOrfaos(destino.out, destino.fase, falhas);
        log(
          `  aviso: ${falhas.length} de ${caminhos.length} arquivos NÃO foram apagados do R2 (lista em ${arquivo}): ${falhas.join(', ')}`,
        );
      }
      return falhas;
    },
  };
}

export async function limparEPropagar(
  erroOriginal: unknown,
  limpeza: () => Promise<unknown>,
  log: (mensagem: string) => void = console.error,
): Promise<never> {
  try {
    await limpeza();
  } catch (erroDaLimpeza) {
    log(
      `  aviso: a limpeza do rollback também falhou (${(erroDaLimpeza as Error)?.message ?? erroDaLimpeza}); segue o erro original.`,
    );
  }
  throw erroOriginal;
}

export async function emParalelo<T>(
  itens: T[],
  limite: number,
  tarefa: (item: T) => Promise<void>,
): Promise<void> {
  let proximo = 0;
  let falha: { erro: unknown } | null = null;
  const trabalhadores = Array.from(
    { length: Math.min(limite, itens.length) },
    async () => {
      while (!falha && proximo < itens.length) {
        const item = itens[proximo++];
        try {
          await tarefa(item);
        } catch (erro) {
          falha ??= { erro };
        }
      }
    },
  );
  await Promise.all(trabalhadores);
  if (falha) throw (falha as { erro: unknown }).erro;
}
