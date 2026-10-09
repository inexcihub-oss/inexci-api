import { readFileSync } from 'fs';

export type LinhaCsv = Record<string, string | null>;

export interface RegistroCsv {
  campos: string[];
  linha: number;
}

export interface ProblemaCsv {
  tabela: string;
  linha: number;
  motivo: string;
}

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

export function limparCampo(valor: string): string | null {
  if (valor.trim() === '') return null;
  if (/^'-?\d+(\.\d+)?$/.test(valor)) return valor.slice(1);
  return valor;
}

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
    if (campos.length === 1 && campos[0] === '') continue;
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
