import { OperationDraftType } from '../drafts/operation-draft.types';

/**
 * Schema padronizado para todas as tools (Fase 7 do Blueprint v3).
 *
 * Substitui contratos diversos atuais (apenas `AiTool` com `name` + `definition`).
 * Permite consultas como:
 *   - "qual o custo estimado de um turno com `mutating` tools?"
 *   - "quais tools requerem confirmação antes de mutar?"
 *   - "rate limit já estourado?"
 *
 * Migração incremental: tools que ainda não declararam `spec` são tratadas
 * como `category: 'utility'` + `determinismLevel: 'mutating'` por segurança.
 */
export type AiToolCategory =
  | 'planning'
  | 'query'
  | 'mutation'
  | 'draft'
  | 'utility';

export type AiToolDeterminism = 'pure' | 'idempotent' | 'mutating';

export type AiToolEstimatedCost = 'free' | 'cheap' | 'standard' | 'expensive';

export interface AiToolRateLimit {
  /**
   * Janela em formato curto (`'1m'`, `'1h'`, `'1d'`). O `ToolExecutorService`
   * calcula o reset baseado nesta string.
   */
  window: '1m' | '5m' | '1h' | '1d';
  /** Máximo de execuções por (ownerId, tool, window). */
  max: number;
}

export interface AiToolSpec {
  name: string;
  category: AiToolCategory;
  /** Tipo de draft a que a tool é relevante (ou `null` se global). */
  draftAffinity: OperationDraftType | null;
  /** Descrição curta (≤ 1 linha) — usada em telemetria. */
  description: string;
  determinismLevel: AiToolDeterminism;
  /**
   * Quando `true`, a tool não executa o efeito imediatamente; produz uma
   * `pending_confirmation` no envelope canônico e o orchestrator reapresenta
   * ao usuário.
   */
  requiresConfirmation: boolean;
  estimatedCost: AiToolEstimatedCost;
  rateLimit?: AiToolRateLimit;
}

/**
 * Default seguro para tools que ainda não declararam `spec` explicitamente.
 * Tratadas como utility/mutating até serem migradas — evita execução
 * acidental sem confirmação ou contagem errada de custo.
 */
export const DEFAULT_TOOL_SPEC: Omit<AiToolSpec, 'name'> = {
  category: 'utility',
  draftAffinity: null,
  description: '',
  determinismLevel: 'mutating',
  requiresConfirmation: false,
  estimatedCost: 'standard',
};
