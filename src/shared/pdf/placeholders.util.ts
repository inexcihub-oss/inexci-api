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
const DIAS_COM_PALAVRA = /\{\{\s*dias\s*\}\}(\s+)dia(?:s|\(s\))?(?!\p{L})/giu;

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
  opcoes: {
    /**
     * Chaves que ficam literais quando ainda não têm valor. Aplicar o modelo
     * antes de escolher os dias de afastamento não pode apagar `{{dias}}`: o
     * placeholder segue no texto e a emissão o preenche com o valor final.
     */
    manterSemValor?: readonly DocumentPlaceholder[];
  } = {},
): string {
  const dias = valores.dias;
  const n = Number(dias);
  const concordado =
    dias === null ||
    dias === undefined ||
    String(dias).trim() === '' ||
    !Number.isFinite(n)
      ? texto
      : texto.replace(
          DIAS_COM_PALAVRA,
          (_inteiro, espaco: string) =>
            `${dias}${espaco}${n === 1 ? 'dia' : 'dias'}`,
        );

  return concordado.replace(PADRAO, (inteiro, chave: string) => {
    if (!(chave in DOCUMENT_PLACEHOLDERS)) return inteiro;
    const valor = valores[chave as DocumentPlaceholder];
    if (valor === null || valor === undefined) {
      return opcoes.manterSemValor?.includes(chave as DocumentPlaceholder)
        ? inteiro
        : '';
    }
    return String(valor);
  });
}
