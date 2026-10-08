/**
 * Placeholders dos modelos de documento clínico (MIG-06). A lista é a única
 * fonte da verdade: o frontend mostra os mesmos rótulos na barra de inserção.
 */
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

/** Valores disponíveis na emissão; ausente = o dado não existe (ex.: sem CPF). */
export type PlaceholderValues = Partial<
  Record<DocumentPlaceholder, string | number | null | undefined>
>;

const PADRAO = /\{\{\s*([a-zA-Z.]+)\s*\}\}/g;

/**
 * `{{dias}}` seguido da palavra "dia"/"dias"/"dia(s)". O modelo é escrito uma
 * vez ("pelo período de {{dias}} dias") e serve para qualquer afastamento —
 * com 1 dia, sairia "1 dias".
 */
const DIAS_COM_PALAVRA = /\{\{\s*dias\s*\}\}(\s+)(dia(?:s|\(s\))?)(?!\p{L})/giu;

/**
 * "dia"/"dias" na caixa que o modelo usou: "{{dias}} Dias" segue "Dias",
 * "{{dias}} DIAS" segue "DIAS".
 */
function palavraDia(original: string, plural: boolean): string {
  const palavra = plural ? 'dias' : 'dia';
  if (original === original.toUpperCase()) return palavra.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return palavra[0].toUpperCase() + palavra.slice(1);
  }
  return palavra;
}

/**
 * Chave do placeholder normalizada: o lookup é insensível à caixa
 * (`{{DIAS}}`, `{{Paciente.Nome}}`). Só a lista própria conta — `in` aceitaria
 * chaves do protótipo (`{{constructor}}`).
 */
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

/** Resultado detalhado de `aplicarPlaceholdersDetalhado`. */
export interface PlaceholdersAplicados {
  texto: string;
  /** Placeholders conhecidos que o texto **original** continha. */
  presentes: ReadonlySet<DocumentPlaceholder>;
  /** Dos presentes, os que não tinham valor (vazios ou mantidos literais). */
  semValor: ReadonlySet<DocumentPlaceholder>;
}

/** Placeholders conhecidos presentes no texto (caixa ignorada). */
export function placeholdersNoTexto(texto: string): Set<DocumentPlaceholder> {
  const presentes = new Set<DocumentPlaceholder>();
  for (const [, chave] of texto.matchAll(PADRAO)) {
    const conhecida = chaveConhecida(chave);
    if (conhecida) presentes.add(conhecida);
  }
  return presentes;
}

/**
 * Troca `{{chave}}` pelo valor. Chave conhecida sem valor vira texto vazio (o
 * paciente sem CPF não imprime "{{paciente.cpf}}"); chave desconhecida fica
 * literal, para o médico ver o erro de digitação na prévia.
 *
 * Texto puro entra e texto puro sai: quem escapa para o PDF é o Handlebars.
 */
export function aplicarPlaceholders(
  texto: string,
  valores: PlaceholderValues,
  opcoes: OpcoesDePlaceholder = {},
): string {
  return aplicarPlaceholdersDetalhado(texto, valores, opcoes).texto;
}

interface OpcoesDePlaceholder {
  /**
   * Chaves que ficam literais quando ainda não têm valor. Aplicar o modelo
   * antes de escolher os dias de afastamento não pode apagar `{{dias}}`: o
   * placeholder segue no texto e a emissão o preenche com o valor final.
   */
  manterSemValor?: readonly DocumentPlaceholder[];
}

/**
 * Igual a `aplicarPlaceholders`, mas informa quais placeholders o texto tinha
 * e quais ficaram sem valor — quem emite decide por aí (ex.: o texto do
 * atestado já traz `{{dias}}`, então não precisa da nota de afastamento; ou
 * depende de `{{dias}}` sem dias informados, e aí é erro).
 */
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
