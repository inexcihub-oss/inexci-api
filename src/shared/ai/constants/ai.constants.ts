/**
 * Constantes globais da camada de IA da INEXCI.
 * Fase 9 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md` — consolidação em arquivo único.
 *
 * Centraliza constantes antes dispersas em múltiplos serviços, evitando
 * referências cruzadas e facilitando ajuste de parâmetros.
 */

// ── WhatsApp / Resposta ──────────────────────────────────────────────────────

/**
 * Comprimento máximo da resposta final antes do truncamento de emergência.
 * Aplicado no `AiOrchestratorService` após todas as normalizações.
 * Deve ser ≥ `WHATSAPP_TARGET_LENGTH`.
 */
export const MAX_RESPONSE_LENGTH = 1000;

/**
 * Comprimento alvo da resposta normalizada pelo `ResponseNormalizerService`.
 * Quando excedido, a mensagem é truncada com reticências.
 */
export const WHATSAPP_TARGET_LENGTH = 850;

// ── PII Vault ────────────────────────────────────────────────────────────────

/**
 * TTL (em segundos) dos bindings do PII vault persistidos no Redis entre turnos.
 * Maior que `AI_SESSION_TIMEOUT_MINUTES` (default 30 min) para tolerar pequenas
 * variações de janela; valores expirados são reconstituídos na próxima execução
 * da tool relevante.
 */
export const PII_VAULT_PERSIST_TTL_SECONDS = 60 * 60;

// ── Pricing OpenAI ───────────────────────────────────────────────────────────

/**
 * Custo por 1K tokens (centavos de USD) — preços OpenAI vigentes.
 * Mantenha sincronizado com a tabela oficial de pricing da OpenAI.
 * Quando um modelo não estiver mapeado, o estimador de custo retorna `null`.
 */
export const MODEL_COST_PER_1K: Record<
  string,
  { input: number; output: number }
> = {
  'gpt-4o': { input: 0.25, output: 1.0 },
  'gpt-4o-2024-08-06': { input: 0.25, output: 1.0 },
  'gpt-4o-2024-11-20': { input: 0.25, output: 1.0 },
  'gpt-4o-mini': { input: 0.015, output: 0.06 },
  'gpt-4o-mini-2024-07-18': { input: 0.015, output: 0.06 },
  'gpt-4.1': { input: 0.2, output: 0.8 },
  'gpt-4.1-mini': { input: 0.04, output: 0.16 },
  'gpt-4.1-nano': { input: 0.01, output: 0.04 },
  'gpt-5': { input: 0.125, output: 1.0 },
  'gpt-5-mini': { input: 0.025, output: 0.2 },
  'gpt-5-nano': { input: 0.005, output: 0.04 },
  'gpt-4-turbo': { input: 1.0, output: 3.0 },
  'gpt-3.5-turbo': { input: 0.05, output: 0.15 },
};
