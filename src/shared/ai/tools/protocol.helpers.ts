/**
 * Helpers compartilhados para manipulação de protocolos de SC nas AI tools.
 *
 * Convenções importantes:
 * - O `protocol` no banco é armazenado SEM prefixo (`generate_protocol()` em
 *   PostgreSQL devolve só os 6 dígitos, ex.: `"468131"`).
 * - O usuário enxerga o protocolo SEMPRE com prefixo `SC-` (ex.: `"SC-468131"`).
 * - Em todas as `tokenizePii(..., 'protocol', ...)` chamadas, DEVEMOS passar
 *   o protocolo SEM prefixo para o vault. Caso contrário, o LLM tende a
 *   escrever `"SC-{{protocol_n}}"` (porque já viu o padrão "SC-" em outros
 *   pontos do contexto) e o `detokenize` produz `"SC-SC-468131"` — bug
 *   reportado no print de 2026-05-10. As tool outputs devem prefixar `SC-`
 *   FORA do placeholder, ex.: `` `SC-${protocolToken}` ``.
 */

/**
 * Remove TODOS os prefixos `SC-` consecutivos (case-insensitive) de um
 * protocolo, devolvendo apenas o sufixo numérico/alfanumérico.
 *
 * Importante: tira `SC-` repetidamente (não só uma vez) porque o usuário
 * pode digitar `"SC-SC-468131"`, e bindings legados do `PiiVaultService`
 * (anteriores ao fix do `stripScPrefix` original) podem armazenar
 * `realValue = "SC-468131"`. Quando a IA passa `"SC-{{protocol_n}}"` como
 * argumento, o detokenize gera `"SC-SC-468131"` — e a busca no banco precisa
 * resolver para `"468131"`.
 */
export function stripScPrefix(protocol: unknown): string {
  let value = String(protocol ?? '').trim();
  if (!value) return '';
  while (/^sc-/i.test(value)) {
    value = value.replace(/^sc-/i, '').trim();
  }
  return value;
}

/**
 * Devolve o protocolo formatado para exibição direta (sem passar pelo vault),
 * sempre com prefixo `SC-`. Use APENAS quando o valor não vai ser tokenizado.
 */
export function formatScProtocolForDisplay(protocol: unknown): string {
  const stripped = stripScPrefix(protocol);
  if (!stripped) return 'SC-N/D';
  return `SC-${stripped.toUpperCase()}`;
}

/**
 * Gera os candidatos plausíveis para procurar o `protocol` no banco a partir
 * de um identificador vindo da IA/usuário. O banco armazena o protocol SEM
 * prefixo (ex.: `"468131"`), mas o LLM e o usuário costumam digitar
 * `"SC-468131"`. Aceitamos apenas as duas formas válidas: a versão crua
 * (`"468131"`) e a versão padrão (`"SC-468131"`).
 *
 * Formas patológicas como `"SC-SC-XXX"` NÃO são toleradas aqui — esse padrão
 * indica que a IA duplicou o prefixo e a defesa correta é impedir a
 * duplicação na saída (`collapseDuplicatedScPrefixes` aplicado no envio ao
 * WhatsApp e no histórico) e manter o vault sempre normalizado
 * (`PiiVaultService` grava `protocol` sem `SC-`).
 */
export function buildProtocolCandidates(identifier: string): string[] {
  const cleaned = String(identifier ?? '').trim();
  if (!cleaned) return [];

  const upper = cleaned.toUpperCase();
  const candidates = new Set<string>([upper]);

  if (upper.startsWith('SC-')) {
    const withoutPrefix = upper.slice(3).trim();
    if (withoutPrefix) candidates.add(withoutPrefix);
  } else {
    candidates.add(`SC-${upper}`);
  }

  return Array.from(candidates).filter(Boolean);
}

/**
 * Colapsa prefixos `SC-` consecutivos em um único `SC-` ao longo de um texto
 * livre (ex.: `"a SC-SC-468131 e a SC-SC-SC-9999"` → `"a SC-468131 e a
 * SC-9999"`). Também colapsa antes de placeholders do PII vault
 * (`"SC-SC-{{protocol_1}}"` → `"SC-{{protocol_1}}"`) para evitar que o erro
 * se propague no histórico conversacional.
 *
 * Aplicado defensivamente em duas etapas no orchestrator:
 *  - na resposta JÁ detokenizada antes do envio ao WhatsApp;
 *  - no texto sanitizado salvo no histórico (ainda com placeholders).
 *
 * Garante que uma alucinação da IA — que vê o padrão `"SC-{{protocol_n}}"`
 * no contexto e por engano prefixa MAIS um `"SC-"` — não chegue ao usuário
 * com `"SC-SC-468131"` e não envenena o histórico para o próximo turno.
 *
 * Preserva o case do primeiro `SC-` original (`"sc-sc-"` → `"sc-"`).
 */
export function collapseDuplicatedScPrefixes(text: string): string {
  if (!text) return text || '';
  return text.replace(/(?:SC-){2,}(?=[\w{])/gi, (match) => match.slice(0, 3));
}
