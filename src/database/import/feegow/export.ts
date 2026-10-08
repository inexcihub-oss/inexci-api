import { existsSync, realpathSync, statSync } from 'fs';
import { join, resolve, sep } from 'path';
import { LinhaCsv, lerCsv, ProblemaCsv } from '../core/csv';

/** Pasta das tabelas dentro do backup estruturado do Feegow. */
export const PASTA_TABELAS = join('database', 'Dados do Cliente');

/**
 * Acesso preguiçoso às tabelas do backup do Feegow (`<dir>/database/Dados do
 * Cliente/<tabela>.csv`). Cada tabela é lida uma vez. Tabela ausente vira
 * lista vazia — o Feegow omite CSVs de módulos não usados.
 *
 * Linha malformada (número de campos diferente do cabeçalho) fica de fora e
 * vai para `problemas`; o runner passa para o relatório da fase que leu a
 * tabela (`drenarProblemas`).
 *
 * Também aceita as tabelas em memória, para os testes com fixtures.
 */
export class ExportFeegow {
  private readonly cache = new Map<string, LinhaCsv[]>();
  private problemas: ProblemaCsv[] = [];

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
    // Parte do nome vem do CSV (`_<modelo_id>` dos formulários): nada de
    // separador nem `..`, senão um modelo_id forjado lê CSV de fora do export.
    if (/[\\/\0]/.test(nome) || nome.includes('..')) return [];
    const caminho = join(this.dir, PASTA_TABELAS, `${nome}.csv`);
    const linhas = existsSync(caminho)
      ? lerCsv(caminho, nome, this.problemas)
      : [];
    this.cache.set(nome, linhas);
    return linhas;
  }

  /** Linhas descartadas nas tabelas lidas desde a última chamada. */
  drenarProblemas(): ProblemaCsv[] {
    const problemas = this.problemas;
    this.problemas = [];
    return problemas;
  }

  /**
   * Caminho de um arquivo binário do export (`Client/Perfil`,
   * `Client/Arquivos`). O primeiro argumento é a pasta; os demais vêm do CSV
   * (`arquivos.NomeArquivo`, `pacientes.foto`) e não são confiáveis: nome que
   * sai da pasta (`../../.ssh/id_rsa`, caminho absoluto) devolve `null`, e o
   * mapper rejeita a linha no relatório como arquivo ausente.
   *
   * O export vem do cliente, então o arquivo pode ser um symlink
   * (`exame.pdf -> /proc/self/cwd/.env`): o caminho real também precisa
   * cair dentro da pasta e ser um arquivo comum, senão o anexo subiria para
   * o R2 o conteúdo de qualquer arquivo da máquina que roda a importação.
   * Arquivo inexistente devolve o caminho mesmo (o mapper reporta ausente).
   */
  arquivo(pasta: string, ...nomes: string[]): string | null {
    if (!this.dir) return null;
    const base = resolve(this.dir, 'Client', pasta);
    if (!nomes.length) return base;
    if (nomes.some((n) => n.includes('\0'))) return null;
    const alvo = resolve(base, ...nomes);
    if (!alvo.startsWith(base + sep)) return null;
    let real: string;
    try {
      real = realpathSync(alvo);
    } catch (erro) {
      return (erro as NodeJS.ErrnoException).code === 'ENOENT' ? alvo : null;
    }
    const baseReal = realpathSync(base);
    if (!real.startsWith(baseReal + sep) || !statSync(real).isFile()) {
      return null;
    }
    return real;
  }
}

/** `sys_active` do Feegow: `1` ativo, `0` inativo/rascunho, `-1` excluído. */
export const ativo = (l: LinhaCsv) => l.sys_active === '1';
export const excluido = (l: LinhaCsv) => l.sys_active === '-1';
