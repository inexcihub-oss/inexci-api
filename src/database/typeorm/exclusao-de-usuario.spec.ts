import * as fs from 'fs';
import * as path from 'path';

/**
 * Excluir um usuário — ou a conta inteira — precisa funcionar em uma operação
 * só, sem limpar dependências à mão antes.
 *
 * O que trava não são as chaves para `users`, que já cascateiam, e sim um
 * `RESTRICT`/`NO ACTION` em qualquer tabela alcançada pela cascata: ele aborta
 * a operação inteira, e o erro do Postgres só cita a constraint. Este teste
 * percorre o schema como o Postgres percorreria e falha se alguma migration
 * futura reintroduzir um bloqueio nesse caminho.
 */
const DIR_MIGRATIONS = path.join(__dirname, 'migrations');

interface ChaveEstrangeira {
  tabelaFilha: string;
  coluna: string;
  tabelaPai: string;
  acao: string;
}

const FK = new RegExp(
  'CONSTRAINT\\s+"(?<nome>[^"]+)"\\s*\\n?\\s*FOREIGN KEY\\s*\\(\\s*"(?<col>[^"]+)"\\s*\\)\\s*' +
    'REFERENCES\\s+"(?<pai>[^"]+)"\\s*\\("[^"]+"\\)' +
    '\\s*(?:ON DELETE (?<acao>CASCADE|SET NULL|RESTRICT|NO ACTION|SET DEFAULT))?',
  'gs',
);

/** Só o `up()`: o `down()` descreve o estado que a migration desfaz. */
function corpoUp(conteudo: string): string {
  const inicio = conteudo.indexOf('public async up(');
  const fim = conteudo.indexOf('public async down(');
  return conteudo.slice(inicio, fim > inicio ? fim : conteudo.length);
}

/** Tabela de cada constraint: o `CREATE`/`ALTER TABLE` mais próximo acima. */
function tabelaDaConstraint(up: string, posicao: number): string {
  const antes = up.slice(0, posicao);
  const criacoes = [
    ...antes.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? "([^"]+)"/g),
  ];
  const alteracoes = [...antes.matchAll(/ALTER TABLE "([^"]+)"/g)];
  const ultimaCriacao = criacoes.at(-1);
  const ultimaAlteracao = alteracoes.at(-1);
  const vencedor =
    (ultimaAlteracao?.index ?? -1) > (ultimaCriacao?.index ?? -1)
      ? ultimaAlteracao
      : ultimaCriacao;
  return vencedor?.[1] ?? '';
}

/**
 * Estado final do schema: as migrations rodam em ordem de timestamp, e o nome
 * do arquivo começa por ele — ordenar por nome é ordenar por cronologia. Uma
 * migration posterior que recria a constraint sobrescreve a anterior.
 */
function chavesEstrangeiras(): Map<string, ChaveEstrangeira> {
  const estado = new Map<string, ChaveEstrangeira>();

  for (const arquivo of fs.readdirSync(DIR_MIGRATIONS).sort()) {
    if (!/\.(ts|js)$/.test(arquivo)) continue;
    const up = corpoUp(
      fs.readFileSync(path.join(DIR_MIGRATIONS, arquivo), 'utf-8'),
    );

    for (const m of up.matchAll(FK)) {
      const { nome, col, pai, acao } = m.groups!;
      estado.set(nome, {
        tabelaFilha: tabelaDaConstraint(up, m.index!),
        coluna: col,
        tabelaPai: pai,
        acao: acao ?? 'NO ACTION',
      });
    }
  }
  return estado;
}

/** Tabelas cujas linhas somem junto com o usuário, seguindo as cascatas. */
function alcancadasPelaCascata(fks: ChaveEstrangeira[]): Set<string> {
  const alcancadas = new Set(['users']);
  let cresceu = true;

  while (cresceu) {
    cresceu = false;
    for (const fk of fks) {
      if (
        fk.acao === 'CASCADE' &&
        alcancadas.has(fk.tabelaPai) &&
        !alcancadas.has(fk.tabelaFilha)
      ) {
        alcancadas.add(fk.tabelaFilha);
        cresceu = true;
      }
    }
  }
  return alcancadas;
}

describe('exclusão de usuário', () => {
  const fks = [...chavesEstrangeiras().entries()];

  it('lê as chaves estrangeiras das migrations', () => {
    expect(fks.length).toBeGreaterThan(50);
    expect(fks.every(([, fk]) => fk.tabelaFilha !== '')).toBe(true);
  });

  it('nenhuma restrição bloqueia a cascata que parte de um usuário', () => {
    const alcancadas = alcancadasPelaCascata(fks.map(([, fk]) => fk));

    const bloqueios = fks
      .filter(
        ([, fk]) =>
          (fk.acao === 'RESTRICT' || fk.acao === 'NO ACTION') &&
          alcancadas.has(fk.tabelaPai),
      )
      .map(
        ([nome, fk]) =>
          `${nome}: ${fk.tabelaFilha}.${fk.coluna} -> ${fk.tabelaPai} (${fk.acao})`,
      );

    expect(bloqueios).toEqual([]);
  });

  /**
   * `surgery_requests.created_by_id` é NOT NULL: `SET NULL` ali não é uma
   * alternativa mais branda ao `CASCADE`, é uma exclusão que aborta por
   * violação de not-null. Foi assim que o schema nasceu.
   */
  it('não devolve SET NULL para uma coluna obrigatória', () => {
    const criacao = fs.readFileSync(
      path.join(DIR_MIGRATIONS, '1746144400000-CreateSurgeryRequests.ts'),
      'utf-8',
    );
    expect(criacao).toContain('"created_by_id"            UUID NOT NULL');
    expect(
      chavesEstrangeiras().get('fk_surgery_requests_created_by')!.acao,
    ).toBe('CASCADE');
  });
});
