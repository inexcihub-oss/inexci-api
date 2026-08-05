import * as fs from 'fs';
import * as path from 'path';

/**
 * Guarda contra o que derrubou o deploy de 05/08/2026: uma migration que
 * adiciona restrição (`CREATE UNIQUE INDEX`) contra dado legado que a viola.
 * O erro do Postgres não diz quais linhas colidem, o container reinicia em
 * loop e a API fica fora do ar até o `deploy.sh` desistir.
 *
 * Regra: migration nova que aperta o schema precisa verificar o dado antes,
 * usando o registro em `preflight/data-checks.ts` — o mesmo que o
 * `yarn migration:preflight` roda read-only contra produção. Assim o conflito
 * aparece como diagnóstico acionável, e antes do deploy, não durante.
 *
 * Se a restrição for sobre coluna/tabela recém-criada na própria migration,
 * não há dado legado possível: some com a criação e a regra deixa de valer,
 * ou registre o arquivo em ANTERIORES_A_REGRA com o motivo.
 */
const DIR_MIGRATIONS = path.join(__dirname, 'migrations');
const MODULO_DE_VERIFICACAO = 'preflight/data-checks';

const DDL_RESTRITIVO = [
  { rotulo: 'CREATE UNIQUE INDEX', regex: /CREATE\s+UNIQUE\s+INDEX/i },
  { rotulo: 'ADD CONSTRAINT', regex: /ADD\s+CONSTRAINT/i },
  { rotulo: 'SET NOT NULL', regex: /SET\s+NOT\s+NULL/i },
];

/**
 * Migrations anteriores à regra: já rodaram em produção, então re-escrevê-las
 * não protege nada. Esta lista não deve crescer.
 */
const ANTERIORES_A_REGRA = [
  '1746144100000-CreateUsersAndAuth.ts',
  '1746144200000-CreateBilling.ts',
  '1746144300000-CreateCoreEntities.ts',
  '1746144600000-CreateWhatsappAndAi.ts',
  '1752300300000-AddPatientAndClinicalRecordToDocuments.ts',
  '1752300400000-AddUniqueClinicalRecordPerAppointment.ts',
  '1752300500000-AddSurgicalIndicationToClinicalRecords.ts',
];

function listarMigrations(): string[] {
  return fs
    .readdirSync(DIR_MIGRATIONS)
    .filter((arquivo) => /\.(ts|js)$/.test(arquivo));
}

function restricoesEm(conteudo: string): string[] {
  return DDL_RESTRITIVO.filter(({ regex }) => regex.test(conteudo)).map(
    ({ rotulo }) => rotulo,
  );
}

describe('migrations com DDL restritivo', () => {
  const arquivos = listarMigrations();

  it('encontra migrations para inspecionar', () => {
    expect(arquivos.length).toBeGreaterThan(0);
  });

  it('toda migration nova que aperta o schema verifica o dado antes', () => {
    const semVerificacao = arquivos
      .filter((arquivo) => !ANTERIORES_A_REGRA.includes(arquivo))
      .map((arquivo) => ({
        arquivo,
        conteudo: fs.readFileSync(path.join(DIR_MIGRATIONS, arquivo), 'utf-8'),
      }))
      .filter(({ conteudo }) => restricoesEm(conteudo).length > 0)
      .filter(({ conteudo }) => !conteudo.includes(MODULO_DE_VERIFICACAO))
      .map(
        ({ arquivo, conteudo }) =>
          `${arquivo} (${restricoesEm(conteudo).join(', ')})`,
      );

    expect(semVerificacao).toEqual([]);
  });

  it('a lista de exceções só cita migrations que existem', () => {
    const inexistentes = ANTERIORES_A_REGRA.filter(
      (arquivo) => !arquivos.includes(arquivo),
    );

    expect(inexistentes).toEqual([]);
  });

  it('a lista de exceções só cita migrations que de fato apertam o schema', () => {
    const semRestricao = ANTERIORES_A_REGRA.filter((arquivo) => {
      const caminho = path.join(DIR_MIGRATIONS, arquivo);
      if (!fs.existsSync(caminho)) return false;
      return restricoesEm(fs.readFileSync(caminho, 'utf-8')).length === 0;
    });

    expect(semRestricao).toEqual([]);
  });
});
