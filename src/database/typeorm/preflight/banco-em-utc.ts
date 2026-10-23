import { QueryRunner } from 'typeorm';

const FUSOS_UTC = [
  'UTC',
  'ETC/UTC',
  'UCT',
  'ETC/UCT',
  'GMT',
  'ETC/GMT',
  'UNIVERSAL',
  'ZULU',
];

export const CONSULTA_FUSO_DO_BANCO = `SELECT current_setting('TimeZone') AS fuso`;

export async function exigirBancoEmUtc(
  queryRunner: Pick<QueryRunner, 'query'>,
  migration: string,
): Promise<void> {
  const linhas = (await queryRunner.query(CONSULTA_FUSO_DO_BANCO)) as
    | Array<{ fuso?: unknown }>
    | undefined;
  const fuso = typeof linhas?.[0]?.fuso === 'string' ? linhas[0].fuso : '';
  if (FUSOS_UTC.includes(fuso.toUpperCase())) return;
  throw new Error(
    `${migration} bloqueada: a sessão do Postgres está no fuso "${fuso || 'desconhecido'}". ` +
      'Os horários sem fuso foram gravados em UTC (API e Postgres em UTC); convertê-los com outro fuso deslocaria todas as datas. ' +
      "Rode as migrations com TZ=UTC e o banco em UTC (ALTER DATABASE <banco> SET timezone TO 'UTC') antes de repetir.",
  );
}
