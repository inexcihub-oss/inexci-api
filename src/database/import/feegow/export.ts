import { existsSync, realpathSync, statSync } from 'fs';
import { join, resolve, sep } from 'path';
import { LinhaCsv, lerCsv, ProblemaCsv } from '../core/csv';

export const PASTA_TABELAS = join('database', 'Dados do Cliente');

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
    if (/[\\/\0]/.test(nome) || nome.includes('..')) return [];
    const bruto = join(this.dir, PASTA_TABELAS, `${nome}.csv`);
    const caminho = this.dentroDoExport(bruto);
    if (!caminho && existsSync(bruto)) {
      this.problemas.push({
        tabela: nome,
        linha: 0,
        motivo: 'CSV ignorado: aponta para fora do export ou não é arquivo',
      });
    }
    const linhas = caminho ? lerCsv(caminho, nome, this.problemas) : [];
    this.cache.set(nome, linhas);
    return linhas;
  }

  drenarProblemas(): ProblemaCsv[] {
    const problemas = this.problemas;
    this.problemas = [];
    return problemas;
  }

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
    const raiz = this.raizReal();
    let baseReal: string;
    try {
      baseReal = realpathSync(base);
    } catch {
      return null;
    }
    if (
      !raiz ||
      !dentro(baseReal, raiz) ||
      !real.startsWith(baseReal + sep) ||
      !statSync(real).isFile()
    ) {
      return null;
    }
    return real;
  }

  private raizReal(): string | null {
    if (!this.dir) return null;
    try {
      return realpathSync(this.dir);
    } catch {
      return null;
    }
  }

  private dentroDoExport(caminho: string): string | null {
    if (!existsSync(caminho)) return null;
    const raiz = this.raizReal();
    if (!raiz) return null;
    let real: string;
    try {
      real = realpathSync(caminho);
    } catch {
      return null;
    }
    return dentro(real, raiz) && statSync(real).isFile() ? real : null;
  }
}

const dentro = (caminho: string, raiz: string) =>
  caminho.startsWith(raiz + sep);

export const ativo = (l: LinhaCsv) => l.sys_active === '1';
export const excluido = (l: LinhaCsv) => l.sys_active === '-1';
