import { paraCentavos, ValorMonetario } from './dinheiro';

export type CelulaCsv = string | number | null | undefined;

const SEPARADOR = ';';

export function valorCsv(valor: ValorMonetario): string {
  const centavos = paraCentavos(valor);
  const absoluto = Math.abs(centavos);
  const reais = Math.floor(absoluto / 100);
  const resto = String(absoluto % 100).padStart(2, '0');
  return `${centavos < 0 ? '-' : ''}${reais},${resto}`;
}

const INICIO_DE_FORMULA = /^[=+\-@\t\r]/;
const NUMERO_LITERAL = /^-?\d+(,\d+)?$/;

export function neutralizarFormula(texto: string): string {
  if (!INICIO_DE_FORMULA.test(texto) || NUMERO_LITERAL.test(texto)) {
    return texto;
  }
  return `'${texto}`;
}

function escaparCelula(celula: CelulaCsv): string {
  if (celula === null || celula === undefined) return '';
  const texto =
    typeof celula === 'number' ? String(celula) : neutralizarFormula(celula);
  if (/[";\r\n]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

export function gerarCsv(cabecalho: string[], linhas: CelulaCsv[][]): string {
  return [cabecalho, ...linhas]
    .map((linha) => linha.map(escaparCelula).join(SEPARADOR))
    .join('\r\n')
    .concat('\r\n');
}

export const CONTENT_TYPE_CSV = 'text/csv; charset=utf-8';

export const BOM_UTF8 = '\uFEFF';

export function bytesDoCsv(conteudo: string): Buffer {
  return Buffer.from(BOM_UTF8 + conteudo, 'utf-8');
}

export function contentDispositionCsv(nomeArquivo: string): string {
  return `attachment; filename="${nomeArquivo.replace(/[^\w.-]/g, '_')}"`;
}
