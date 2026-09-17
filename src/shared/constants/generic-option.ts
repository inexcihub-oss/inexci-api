/**
 * "Outro" é o fornecedor/fabricante genérico da conta: a resposta para "não é
 * nenhum dos cadastrados". Existe porque a plataforma exige 3 fornecedores e 3
 * fabricantes por item OPME — um rascunho que não tem os três preenche o resto
 * com ele — e porque o convênio às vezes aprova alguém fora dos cotados.
 *
 * É uma linha real na tabela, marcada por `is_generic`, uma por conta, criada
 * sob demanda e escondida do catálogo. A flag existe para que consulta de
 * relatório decida contar ou excluir o genérico de forma determinística, sem
 * depender de comparar texto.
 */
export const GENERIC_OPTION_NAME = 'Outro';

/**
 * Nomes que significam o genérico. O plural é o que o preenchimento automático
 * gravou antes desta regra existir, e continua chegando de solicitação antiga e
 * de modelo salvo.
 */
const GENERIC_OPTION_ALIASES = ['outro', 'outros'];

export function isGenericOptionName(name: string): boolean {
  return GENERIC_OPTION_ALIASES.includes(name.trim().toLowerCase());
}
