export const DOCUMENT_PLACEHOLDERS = {
  'paciente.nome': 'Nome do paciente',
  'paciente.cpf': 'CPF do paciente',
  'paciente.nascimento': 'Data de nascimento do paciente',
  'medico.nome': 'Nome do médico',
  'medico.registro': 'Registro profissional (CRM/CRO e UF)',
  data: 'Data de emissão',
  dias: 'Dias de afastamento',
  inicio: 'Início do afastamento',
} as const;

export type DocumentPlaceholder = keyof typeof DOCUMENT_PLACEHOLDERS;

export type PlaceholderValues = Partial<
  Record<DocumentPlaceholder, string | number | null | undefined>
>;

const PADRAO = /\{\{\s*([a-zA-Z.]+)\s*\}\}/g;

const DIAS_COM_PALAVRA = /\{\{\s*dias\s*\}\}(\s+)(dia(?:s|\(s\))?)(?!\p{L})/giu;

function palavraDia(original: string, plural: boolean): string {
  const palavra = plural ? 'dias' : 'dia';
  if (original === original.toUpperCase()) return palavra.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return palavra[0].toUpperCase() + palavra.slice(1);
  }
  return palavra;
}

function chaveConhecida(chave: string): DocumentPlaceholder | null {
  const normalizada = chave.toLowerCase();
  return Object.prototype.hasOwnProperty.call(
    DOCUMENT_PLACEHOLDERS,
    normalizada,
  )
    ? (normalizada as DocumentPlaceholder)
    : null;
}

const semValor = (valor: unknown): boolean =>
  valor === null || valor === undefined || String(valor).trim() === '';

export interface PlaceholdersAplicados {
  texto: string;
  presentes: ReadonlySet<DocumentPlaceholder>;
  semValor: ReadonlySet<DocumentPlaceholder>;
}

export function placeholdersNoTexto(texto: string): Set<DocumentPlaceholder> {
  const presentes = new Set<DocumentPlaceholder>();
  for (const [, chave] of texto.matchAll(PADRAO)) {
    const conhecida = chaveConhecida(chave);
    if (conhecida) presentes.add(conhecida);
  }
  return presentes;
}

export function aplicarPlaceholders(
  texto: string,
  valores: PlaceholderValues,
  opcoes: OpcoesDePlaceholder = {},
): string {
  return aplicarPlaceholdersDetalhado(texto, valores, opcoes).texto;
}

interface OpcoesDePlaceholder {
  manterSemValor?: readonly DocumentPlaceholder[];
}

export function aplicarPlaceholdersDetalhado(
  texto: string,
  valores: PlaceholderValues,
  opcoes: OpcoesDePlaceholder = {},
): PlaceholdersAplicados {
  const presentes = placeholdersNoTexto(texto);
  const faltando = new Set(
    [...presentes].filter((chave) => semValor(valores[chave])),
  );

  const dias = valores.dias;
  const n = Number(dias);
  const concordado =
    semValor(dias) || !Number.isFinite(n)
      ? texto
      : texto.replace(
          DIAS_COM_PALAVRA,
          (_inteiro, espaco: string, palavra: string) =>
            `${dias}${espaco}${palavraDia(palavra, n !== 1)}`,
        );

  const final = concordado.replace(PADRAO, (inteiro, chave: string) => {
    const conhecida = chaveConhecida(chave);
    if (!conhecida) return inteiro;
    const valor = valores[conhecida];
    if (semValor(valor)) {
      return opcoes.manterSemValor?.includes(conhecida) ? inteiro : '';
    }
    return String(valor);
  });

  return { texto: final, presentes, semValor: faltando };
}
