import {
  LookupResult,
  LookupCandidate,
  LookupStatus,
} from '../services/entity-resolver.service';

/**
 * Status canônico de retorno das tools de mutação / draft.
 *
 * - `ok`                     — operação concluída com sucesso.
 * - `needs_input`            — falta dado obrigatório; `next_required_fields` lista o que.
 * - `pending_confirmation`   — preview gerado; aguardando "sim/confirmo" do usuário.
 * - `blocked`                — pré-condição da regra de negócio falhou
 *                              (ex.: SC já enviada, status não permite, plan_actions faltando).
 * - `error`                  — erro genérico; veja `errors[]`.
 */
export type ToolResultStatus =
  | 'ok'
  | 'needs_input'
  | 'pending_confirmation'
  | 'blocked'
  | 'error';

export interface ToolResultError {
  field?: string;
  code: string;
  message: string;
}

export interface ToolResultPendingConfirmation {
  tool: string;
  args: Record<string, unknown>;
  description: string;
  expires_at?: string | null;
}

export interface ToolResultAffected {
  kind: string;
  id: string;
}

export interface ToolResult<T = unknown> {
  status: ToolResultStatus;
  data?: T;
  summary?: string;
  next_required_fields?: string[];
  pending_confirmation?: ToolResultPendingConfirmation;
  /**
   * Mensagem curta para o LLM consumir. Opcional — quando ausente, o LLM
   * deve usar `display_text` (se houver) ou os dados estruturados em `data`
   * para compor a resposta.
   */
  message?: string;
  /**
   * Texto opcional renderizável diretamente ao usuário no WhatsApp.
   * Quando presente, o LLM deve preferir esse texto a parafrasear.
   */
  display_text?: string;
  errors?: ToolResultError[];
  next_recommended?: string[];
  telemetry?: {
    duration_ms?: number;
    db_queries?: number;
    cache_hit?: boolean;
    truncated?: boolean;
  };
  /**
   * Entidades afetadas pela operação (status `ok`).
   * Usado pelo orchestrator para telemetria e pelo LLM para compor mensagens.
   */
  affected?: ToolResultAffected[];
  /**
   * Versão do envelope. Reservado para evolução futura.
   */
  v?: 1;
}

export interface BuildToolResultOptions<T> {
  status: ToolResultStatus;
  message?: string;
  summary?: string;
  data?: T;
  nextRequiredFields?: string[];
  pendingConfirmation?: ToolResultPendingConfirmation;
  displayText?: string;
  errors?: ToolResultError[];
  affected?: ToolResultAffected[];
  nextRecommended?: string[];
  telemetry?: ToolResult<T>['telemetry'];
}

export function buildToolResult<T = unknown>(
  opts: BuildToolResultOptions<T>,
): string {
  const payload: ToolResult<T> = {
    status: opts.status,
    v: 1,
  };
  if (opts.message) payload.message = opts.message;
  if (opts.summary) payload.summary = opts.summary;
  if (opts.data !== undefined) payload.data = opts.data;
  if (opts.nextRequiredFields && opts.nextRequiredFields.length) {
    payload.next_required_fields = opts.nextRequiredFields;
  }
  if (opts.pendingConfirmation) {
    payload.pending_confirmation = opts.pendingConfirmation;
  }
  if (opts.displayText) payload.display_text = opts.displayText;
  if (opts.errors && opts.errors.length) payload.errors = opts.errors;
  if (opts.affected && opts.affected.length) payload.affected = opts.affected;
  if (opts.nextRecommended && opts.nextRecommended.length) {
    payload.next_recommended = opts.nextRecommended;
  }
  if (opts.telemetry) payload.telemetry = opts.telemetry;
  return JSON.stringify(payload);
}

export function buildPaginatedToolResult<T>(opts: {
  items: T[];
  total: number;
  limit: number;
  summary: string;
  nextCursor?: string | null;
}): string {
  let items = opts.items;
  let truncated = items.length < opts.total;
  let payload = {
    items,
    total: opts.total,
    truncated,
    next_cursor: opts.nextCursor ?? null,
  };

  while (JSON.stringify(payload).length > 10_000 && items.length > 1) {
    items = items.slice(0, Math.max(1, Math.floor(items.length * 0.75)));
    truncated = true;
    payload = {
      items,
      total: opts.total,
      truncated,
      next_cursor: opts.nextCursor ?? null,
    };
  }

  return buildToolResult({
    status: 'ok',
    summary: opts.summary,
    data: payload,
    telemetry: {
      truncated,
    },
  });
}

export interface BuildLookupResultOptions<T> {
  result: LookupResult<T>;
  /**
   * Mapeia cada candidato para o `data` exposto ao LLM. Útil para projetar
   * apenas campos seguros (ex.: id + nome, sem CPF cru).
   */
  projectData?: (candidate: LookupCandidate<T>) => unknown;
  /**
   * Mensagem custom; quando omitida usa `result.message`.
   */
  message?: string;
  /**
   * Sugestão de próxima ação para o LLM. Vai como `display_text`.
   */
  hint?: string;
}

export function buildLookupResult<T>(
  opts: BuildLookupResultOptions<T>,
): string {
  const { result, projectData, message, hint } = opts;
  const project = (c: LookupCandidate<T>) => ({
    id: c.id,
    label: c.label,
    score: c.score,
    data: projectData ? projectData(c) : undefined,
  });
  const payload = {
    status: result.status as LookupStatus,
    query: result.query,
    resolved: result.resolved ? project(result.resolved) : undefined,
    candidates: result.candidates.map(project),
    message: message ?? result.message,
    hint: hint ?? result.hint,
    v: 1 as const,
  };
  return JSON.stringify(payload);
}

export function parseToolResult<T = unknown>(
  raw: string,
): ToolResult<T> | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.status === 'string'
    ) {
      return parsed as ToolResult<T>;
    }
    return null;
  } catch {
    return null;
  }
}
