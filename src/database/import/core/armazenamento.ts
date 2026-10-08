import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Onde a fase `anexos` grava os arquivos (R2 em produção). Separado do
 * `StorageService` para a fase ser testável sem rede e para o script montar o
 * cliente fora do Nest.
 */
export interface ArmazenamentoImportacao {
  /** Envia o arquivo e devolve o caminho gravado no bucket. */
  enviar(arquivo: {
    conteudo: Buffer;
    pasta: string;
    nome: string;
    contentType: string;
    tenantId: string;
  }): Promise<string>;
  /**
   * Remove o que foi enviado (rollback da fase). Devolve as chaves que **não**
   * foram apagadas — o R2 aceita o lote e recusa objeto a objeto, então falha
   * parcial não vira exceção: quem chama decide o que fazer com os órfãos.
   */
  apagar(caminhos: string[]): Promise<string[]>;
}

/** O `DeleteObjects` do S3/R2 aceita até 1000 chaves por chamada. */
export const CHAVES_POR_DELETE = 1000;

/**
 * Apaga em lotes e acumula as chaves que ficaram. `apagarLote` devolve as que
 * falharam (contrato do `StorageService.deleteMany`); se lançar, o lote todo
 * conta como falha e os lotes seguintes ainda são tentados.
 */
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

/**
 * Grava (ou completa) `orfaos-<fase>.json` em `out` com as chaves que ficaram
 * no bucket sem registro no banco. Várias limpezas na mesma fase somam na
 * mesma lista. Devolve o caminho do arquivo.
 */
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
    } catch {
      // arquivo corrompido: reescreve com o que se sabe agora
    }
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

/**
 * Envolve o armazenamento para que toda limpeza que deixe chaves para trás
 * (rollback da fase ou descarte pós-COMMIT) as registre em
 * `orfaos-<fase>.json` e no log, em vez de sumirem em silêncio.
 */
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

/**
 * Roda a limpeza de um rollback sem deixar que uma falha nela esconda o erro
 * que causou o rollback: o erro da limpeza vai para o log, e o original é
 * relançado.
 */
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

/**
 * Roda `tarefa` sobre `itens` com no máximo `limite` em paralelo.
 *
 * Na primeira falha, nenhum item novo começa, mas as tarefas já em andamento
 * terminam antes de a promessa rejeitar (com o primeiro erro). Quem faz
 * rollback depois (`enviarAnexos`) precisa enxergar todo upload que de fato
 * aconteceu — um `Promise.all` rejeitaria na hora e o upload que terminasse
 * depois ficaria órfão no bucket.
 */
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
