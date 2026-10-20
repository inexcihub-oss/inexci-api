export const TELEFONE_BR_CANONICO = /^[1-9]{2}(?:9\d{8}|[2-5]\d{7})$/;

export const TELEFONE_INVALIDO_MENSAGEM =
  'Informe um telefone brasileiro válido com DDD (fixo com 10 ou celular com 11 dígitos)';

export function reduzirTelefone(valor: string | null | undefined): string {
  if (typeof valor !== 'string') return '';
  let digitos = valor.replace(/\D/g, '').replace(/^0+/, '');
  if (
    (digitos.length === 12 || digitos.length === 13) &&
    digitos.startsWith('55')
  ) {
    digitos = digitos.slice(2);
  }
  if (digitos.length === 10 && '6789'.includes(digitos[2])) {
    digitos = `${digitos.slice(0, 2)}9${digitos.slice(2)}`;
  }
  return digitos;
}

export function canonicalizarTelefone(
  valor: string | null | undefined,
): string | null {
  const reduzido = reduzirTelefone(valor);
  return TELEFONE_BR_CANONICO.test(reduzido) ? reduzido : null;
}

export function variantesLegadasDoTelefone(canonico: string): string[] {
  if (!TELEFONE_BR_CANONICO.test(canonico)) return [];
  const locais = [canonico];
  if (canonico.length === 11) {
    locais.push(`${canonico.slice(0, 2)}${canonico.slice(3)}`);
  }
  const variantes = locais.flatMap((local) => [
    local,
    `55${local}`,
    `+55${local}`,
  ]);
  return [...new Set(variantes)];
}

export function telefoneCanonicoSql(expressao: string): string {
  const digitos = `ltrim(regexp_replace(${expressao}, '[^0-9]', '', 'g'), '0')`;
  const semDdi = `(CASE WHEN length(${digitos}) IN (12, 13) AND left(${digitos}, 2) = '55' THEN substr(${digitos}, 3) ELSE ${digitos} END)`;
  return `NULLIF((CASE WHEN length(${semDdi}) = 10 AND substr(${semDdi}, 3, 1) IN ('6', '7', '8', '9') THEN left(${semDdi}, 2) || '9' || substr(${semDdi}, 3) ELSE ${semDdi} END), '')`;
}

export const TELEFONE_BR_CANONICO_SQL = '^[1-9]{2}(9[0-9]{8}|[2-5][0-9]{7})$';
