/**
 * O importador grava `created_at`/`updated_at` históricos em colunas
 * `timestamp` **sem fuso**, e o node-pg serializa `Date` no fuso local do
 * processo. Rodando em America/Sao_Paulo, cada data entraria 3 h adiantada
 * (o resto da API lê essas colunas como UTC). Por isso o script só roda com
 * o processo em UTC (`TZ=UTC`, já no `yarn import:feegow`).
 *
 * `offsetMinutos` é injetável para teste; o padrão é o do processo.
 */
export function assertProcessoEmUtc(
  offsetMinutos: number = new Date().getTimezoneOffset(),
  tz: string | undefined = process.env.TZ,
): void {
  if (offsetMinutos === 0) return;
  const horas = -offsetMinutos / 60;
  const fuso = `UTC${horas >= 0 ? '+' : ''}${horas}`;
  throw new Error(
    `Importador precisa rodar em UTC, mas o processo está em ${tz || 'fuso do sistema'} (${fuso}). ` +
      'As datas históricas seriam gravadas deslocadas em colunas timestamp sem fuso. ' +
      'Rode pelo "yarn import:feegow" (já define TZ=UTC) ou prefixe o comando com TZ=UTC.',
  );
}
