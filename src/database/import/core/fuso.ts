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
