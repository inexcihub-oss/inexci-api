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
