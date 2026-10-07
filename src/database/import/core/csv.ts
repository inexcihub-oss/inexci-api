import { readFileSync } from 'fs';

/** Linha de CSV já normalizada: campo vazio vira `null`. */
export type LinhaCsv = Record<string, string | null>;

/** Registro do CSV com a linha física (1-based) em que começa. */
export interface RegistroCsv {
  campos: string[];
  linha: number;
}

/** Linha do CSV que ficou de fora, para o relatório. */
export interface ProblemaCsv {
  tabela: string;
  linha: number;
  motivo: string;
}

/**
 * Parser de CSV (RFC 4180): vírgula como separador, aspas duplas delimitando
 * campo, `""` como aspa literal e quebra de linha permitida dentro de campo
 * entre aspas (o prontuário do Feegow tem HTML multilinha).
 *
 * Aspas abertas até o fim do arquivo são erro (export truncado ou aspa sem
 * escape): engolir o resto do arquivo num campo só esconderia as linhas.
 *
 * Escrito aqui em vez de adicionar `csv-parse`: o formato é estável, o
 * importador roda uma vez por cliente e não vale uma dependência nova na
 * auditoria (`yarn audit` no CI).
 */
export function parseCsvComLinhas(
  texto: string,
  origem = 'CSV',
): RegistroCsv[] {
  const registros: RegistroCsv[] = [];
  let campo = '';
  let linha: string[] = [];
  let entreAspas = false;
  let linhaFisica = 1;
  let inicioDoRegistro = 1;
  // BOM do UTF-8 no começo do arquivo.
  let i = texto.charCodeAt(0) === 0xfeff ? 1 : 0;

  for (; i < texto.length; i++) {
    const c = texto[i];
    if (c === '\n' || (c === '\r' && texto[i + 1] !== '\n')) linhaFisica++;
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
      if (c === '\r' && texto[i + 1] === '\n') {
        i++;
        linhaFisica++;
      }
      linha.push(campo);
      registros.push({ campos: linha, linha: inicioDoRegistro });
      linha = [];
      campo = '';
      inicioDoRegistro = linhaFisica;
    } else {
      campo += c;
    }
  }
  if (entreAspas) {
    throw new Error(
      `${origem}: aspas sem fechamento no registro que começa na linha ${inicioDoRegistro} (arquivo truncado ou aspa sem escape).`,
    );
  }
  if (campo !== '' || linha.length > 0) {
    linha.push(campo);
    registros.push({ campos: linha, linha: inicioDoRegistro });
  }
  return registros;
}

export function parseCsv(texto: string, origem?: string): string[][] {
  return parseCsvComLinhas(texto, origem).map((r) => r.campos);
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

/**
 * Converte o CSV em objetos pelo cabeçalho, com os campos já limpos.
 *
 * Linha com número de campos diferente do cabeçalho não entra: os valores
 * cairiam nas colunas erradas (vírgula sem aspas, quebra de linha sem aspas
 * partindo o registro). Com `problemas`, a linha é anotada lá (o runner leva
 * ao relatório); sem, é erro — nunca some calada.
 */
export function csvParaObjetos(
  texto: string,
  tabela = 'CSV',
  problemas?: ProblemaCsv[],
): LinhaCsv[] {
  const [cabecalho, ...corpo] = parseCsvComLinhas(texto, tabela);
  if (!cabecalho) return [];
  const colunas = cabecalho.campos;
  const objetos: LinhaCsv[] = [];
  for (const { campos, linha } of corpo) {
    if (campos.length === 1 && campos[0] === '') continue; // linha em branco
    if (campos.length !== colunas.length) {
      const motivo = `${campos.length} campos, cabeçalho tem ${colunas.length} (linha malformada, ignorada)`;
      if (!problemas) throw new Error(`${tabela}, linha ${linha}: ${motivo}`);
      problemas.push({ tabela, linha, motivo });
      continue;
    }
    const obj: LinhaCsv = {};
    colunas.forEach((nome, idx) => {
      obj[nome] = limparCampo(campos[idx]);
    });
    objetos.push(obj);
  }
  return objetos;
}

export function lerCsv(
  caminho: string,
  tabela: string = caminho,
  problemas?: ProblemaCsv[],
): LinhaCsv[] {
  return csvParaObjetos(readFileSync(caminho, 'utf-8'), tabela, problemas);
}
