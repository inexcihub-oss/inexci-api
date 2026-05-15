/**
 * Envelope canônico de tool result (Fase 7 do Blueprint v3, §9.2).
 *
 * Toda tool DEVE devolver, ao final, JSON serializado com este formato.
 * O `parseToolResult` (existente) detecta o `confirmation` para popular o
 * `pendingConfirmation` da memória; o orchestrator usa `summary` para
 * compor a mensagem ao usuário.
 *
 * Tools de listagem usam o helper `buildPaginatedToolResult` para garantir
 * o truncamento estruturado (§9.3) com `items`, `total`, `truncated`,
 * `next_cursor`.
 */

export type ToolStatus =
  | 'ok'
  | 'pending_confirmation'
  | 'error'
  | 'need_input';

export interface ToolConfirmation {
  /** Tool a ser invocada após o usuário confirmar. */
  tool: string;
  /** Args completos para a re-execução. */
  args: Record<string, unknown>;
  /** ISO timestamp — após este momento o orchestrator descarta. */
  expires_at: string;
}

export interface ToolTelemetry {
  duration_ms?: number;
  db_queries?: number;
  cache_hit?: boolean;
}

export interface ToolResultEnvelope<TData = Record<string, unknown>> {
  status: ToolStatus;
  /** Mensagem curta para a UI / LLM compor a resposta. */
  summary: string;
  data: TData;
  /** Lista de tools recomendadas para o próximo passo. */
  next_recommended?: string[];
  confirmation?: ToolConfirmation | null;
  telemetry?: ToolTelemetry;
}

/** Limite hard de bytes para `data` (10 KB) — acima força paginação. */
const MAX_DATA_BYTES = 10 * 1024;

export function serializeToolResult(
  envelope: ToolResultEnvelope,
): string {
  const json = JSON.stringify(envelope);
  return json;
}

export interface PaginatedListResult<TItem> {
  items: TItem[];
  total: number;
  truncated: boolean;
  next_cursor: string | null;
}

/**
 * Constrói envelope para tools de listagem com truncamento estruturado.
 *
 *  - `items` = primeiros `limit` registros (default 20)
 *  - `total` = quantidade total disponível
 *  - `truncated` = `total > items.length`
 *  - `next_cursor` = string opaca para a próxima página, ou `null`
 *
 * Se ainda assim o envelope ultrapassar `MAX_DATA_BYTES`, reduz `limit`
 * pela metade até caber. Isso protege contra rows muito gordos vazando
 * para o LLM e estourando contexto.
 */
export function buildPaginatedToolResult<TItem extends Record<string, unknown>>(
  input: {
    summary: string;
    allItems: TItem[];
    limit?: number;
    nextCursor?: string | null;
    telemetry?: ToolTelemetry;
  },
): ToolResultEnvelope<PaginatedListResult<TItem>> {
  let limit = input.limit ?? 20;
  let items = input.allItems.slice(0, limit);

  // Encolhe limit até o data caber em MAX_DATA_BYTES.
  while (items.length > 1) {
    const trial: ToolResultEnvelope<PaginatedListResult<TItem>> = {
      status: 'ok',
      summary: input.summary,
      data: {
        items,
        total: input.allItems.length,
        truncated: input.allItems.length > items.length,
        next_cursor: input.nextCursor ?? null,
      },
      telemetry: input.telemetry,
    };
    if (Buffer.byteLength(JSON.stringify(trial), 'utf8') <= MAX_DATA_BYTES) {
      return trial;
    }
    limit = Math.floor(limit / 2);
    items = input.allItems.slice(0, Math.max(1, limit));
  }

  return {
    status: 'ok',
    summary: input.summary,
    data: {
      items,
      total: input.allItems.length,
      truncated: input.allItems.length > items.length,
      next_cursor: input.nextCursor ?? null,
    },
    telemetry: input.telemetry,
  };
}

export const TOOL_RESULT_MAX_DATA_BYTES = MAX_DATA_BYTES;
