import * as fs from 'fs';
import * as path from 'path';
import { getMetadataArgsStorage } from 'typeorm';
import { ENTITIES } from '../entities';

const DIR_MIGRATIONS = path.join(__dirname, 'migrations');

type Fuso = 'com fuso' | 'sem fuso';

const fusoDoTipo = (tipo: string): Fuso | null => {
  const t = tipo.toLowerCase().trim();
  if (t === 'timestamptz' || t === 'timestamp with time zone')
    return 'com fuso';
  if (t === 'timestamp' || t === 'timestamp without time zone')
    return 'sem fuso';
  return null;
};

const TIPO =
  '(TIMESTAMPTZ|TIMESTAMP WITH TIME ZONE|TIMESTAMP WITHOUT TIME ZONE|TIMESTAMP)\\b';

function tiposNasMigrations(): Map<string, Fuso> {
  const tipos = new Map<string, Fuso>();
  const arquivos = fs
    .readdirSync(DIR_MIGRATIONS)
    .filter((a) => /\.(ts|js)$/.test(a))
    .sort();
  for (const arquivo of arquivos) {
    const sql = fs.readFileSync(path.join(DIR_MIGRATIONS, arquivo), 'utf-8');
    for (const tabela of sql.matchAll(
      /CREATE TABLE (?:IF NOT EXISTS )?"(\w+)"\s*\(([\s\S]*?)\n\s*\)/g,
    )) {
      for (const coluna of tabela[2].matchAll(
        new RegExp(`"(\\w+)"\\s+${TIPO}`, 'gi'),
      )) {
        tipos.set(`${tabela[1]}.${coluna[1]}`, fusoDoTipo(coluna[2])!);
      }
    }
    for (const coluna of sql.matchAll(
      new RegExp(
        `ALTER TABLE "(\\w+)"[^;\`]*?ADD COLUMN (?:IF NOT EXISTS )?"(\\w+)"\\s+${TIPO}`,
        'gi',
      ),
    )) {
      tipos.set(`${coluna[1]}.${coluna[2]}`, fusoDoTipo(coluna[3])!);
    }
    for (const alteracao of sql
      .split(/down\s*\(/)[0]
      .matchAll(/ALTER TABLE "(\w+)"([\s\S]*?)(?:`|;)/g)) {
      for (const coluna of alteracao[2].matchAll(
        new RegExp(`ALTER COLUMN "(\\w+)" TYPE ${TIPO}`, 'gi'),
      )) {
        tipos.set(`${alteracao[1]}.${coluna[1]}`, fusoDoTipo(coluna[2])!);
      }
    }
  }
  return tipos;
}

function tiposNasEntidades(): Map<string, Fuso> {
  const storage = getMetadataArgsStorage();
  const tipos = new Map<string, Fuso>();
  for (const entidade of ENTITIES) {
    const tabela = storage.tables.find((t) => t.target === entidade)?.name;
    if (!tabela) continue;
    for (const coluna of storage.columns.filter((c) => c.target === entidade)) {
      const ehDataAutomatica = [
        'createDate',
        'updateDate',
        'deleteDate',
      ].includes(coluna.mode);
      const tipo =
        typeof coluna.options.type === 'string'
          ? coluna.options.type
          : ehDataAutomatica
            ? 'timestamp'
            : null;
      const fuso = tipo ? fusoDoTipo(tipo) : null;
      if (!fuso) continue;
      tipos.set(
        `${tabela}.${coluna.options.name ?? coluna.propertyName}`,
        fuso,
      );
    }
  }
  return tipos;
}

describe('colunas de data: entidade x migration', () => {
  it('o fuso declarado na entidade é o mesmo criado pela migration', () => {
    const migrations = tiposNasMigrations();
    const divergentes = [...tiposNasEntidades()]
      .filter(([coluna]) => migrations.has(coluna))
      .filter(([coluna, fuso]) => migrations.get(coluna) !== fuso)
      .map(
        ([coluna, fuso]) =>
          `${coluna}: entidade ${fuso}, migration ${migrations.get(coluna)}`,
      );

    expect(divergentes).toEqual([]);
  });

  it('toda coluna de data e hora guarda o fuso', () => {
    const semFuso = [...tiposNasEntidades()]
      .filter(([, fuso]) => fuso === 'sem fuso')
      .map(([coluna]) => coluna);

    expect(semFuso).toEqual([]);
  });

  it('reconhece a conversão de notifications para timestamptz', () => {
    expect(tiposNasMigrations().get('notifications.created_at')).toBe(
      'com fuso',
    );
  });
});
