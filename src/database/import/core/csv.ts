import { readFileSync } from 'fs';

/** Linha de CSV já normalizada: campo vazio vira `null`. */
export type LinhaCsv = Record<string, string | null>;

/**
 * Parser de CSV (RFC 4180): vírgula como separador, aspas duplas delimitando
 * campo, `""` como aspa literal e quebra de linha permitida dentro de campo
 * entre aspas (o prontuário do Feegow tem HTML multilinha).
 *
 * Escrito aqui em vez de adicionar `csv-parse`: o formato é estável, o
 * importador roda uma vez por cliente e não vale uma dependência nova na
 * auditoria (`yarn audit` no CI).
 */
export function parseCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let entreAspas = false;
  // BOM do UTF-8 no começo do arquivo.
  let i = texto.charCodeAt(0) === 0xfeff ? 1 : 0;

  for (; i < texto.length; i++) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreAspas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }
    if (c === '"') {
      entreAspas = true;
    } else if (c === ',') {
      linha.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo !== '' || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

/**
 * Limpa o valor de um campo do export do Feegow:
 * - vazio ou só espaços → `null`;
 * - artefato `'-1` (aspa simples que o export põe na frente de número
 *   negativo para o Excel não tratar como fórmula) → `-1`.
 */
export function limparCampo(valor: string): string | null {
  if (valor.trim() === '') return null;
  if (/^'-?\d+(\.\d+)?$/.test(valor)) return valor.slice(1);
  return valor;
}

/** Converte o CSV em objetos pelo cabeçalho, com os campos já limpos. */
export function csvParaObjetos(texto: string): LinhaCsv[] {
  const [cabecalho, ...corpo] = parseCsv(texto);
  if (!cabecalho) return [];
  return corpo
    .filter((l) => !(l.length === 1 && l[0] === ''))
    .map((l) => {
      const obj: LinhaCsv = {};
      cabecalho.forEach((nome, idx) => {
        obj[nome] = limparCampo(l[idx] ?? '');
      });
      return obj;
    });
}

export function lerCsv(caminho: string): LinhaCsv[] {
  return csvParaObjetos(readFileSync(caminho, 'utf-8'));
}
