import { existsSync } from 'fs';
import { join } from 'path';
import { LinhaCsv, lerCsv } from '../core/csv';

/** Pasta das tabelas dentro do backup estruturado do Feegow. */
export const PASTA_TABELAS = join('database', 'Dados do Cliente');

/**
 * Acesso preguiçoso às tabelas do backup do Feegow (`<dir>/database/Dados do
 * Cliente/<tabela>.csv`). Cada tabela é lida uma vez. Tabela ausente vira
 * lista vazia — o Feegow omite CSVs de módulos não usados.
 *
 * Também aceita as tabelas em memória, para os testes com fixtures.
 */
export class ExportFeegow {
  private readonly cache = new Map<string, LinhaCsv[]>();

  constructor(
    private readonly dir: string | null,
    tabelas?: Record<string, LinhaCsv[]>,
  ) {
    for (const [nome, linhas] of Object.entries(tabelas ?? {})) {
      this.cache.set(nome, linhas);
    }
  }

  tabela(nome: string): LinhaCsv[] {
    const emCache = this.cache.get(nome);
    if (emCache) return emCache;
    if (!this.dir) return [];
    const caminho = join(this.dir, PASTA_TABELAS, `${nome}.csv`);
    const linhas = existsSync(caminho) ? lerCsv(caminho) : [];
    this.cache.set(nome, linhas);
    return linhas;
  }

  /** Caminho de um arquivo binário do export (`Client/Perfil`, `Client/Arquivos`). */
  arquivo(...partes: string[]): string | null {
    return this.dir ? join(this.dir, 'Client', ...partes) : null;
  }
}

/** `sys_active` do Feegow: `1` ativo, `0` inativo/rascunho, `-1` excluído. */
export const ativo = (l: LinhaCsv) => l.sys_active === '1';
export const excluido = (l: LinhaCsv) => l.sys_active === '-1';
