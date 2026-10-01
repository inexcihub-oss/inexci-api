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
  /** Remove o que foi enviado (rollback da fase). */
  apagar(caminhos: string[]): Promise<void>;
}

/** Roda `tarefa` sobre `itens` com no máximo `limite` em paralelo. */
export async function emParalelo<T>(
  itens: T[],
  limite: number,
  tarefa: (item: T) => Promise<void>,
): Promise<void> {
  let proximo = 0;
  const trabalhadores = Array.from(
    { length: Math.min(limite, itens.length) },
    async () => {
      while (proximo < itens.length) {
        const item = itens[proximo++];
        await tarefa(item);
      }
    },
  );
  await Promise.all(trabalhadores);
}
