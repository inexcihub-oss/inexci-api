import {
  LookupResult,
  LookupCandidate,
  LookupStatus,
} from '../services/entity-resolver.service';

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
}

export interface ToolResultAffected {
  kind: string;
  id: string;
}

export interface ToolResult<T = unknown> {
  status: ToolResultStatus;
  data?: T;
  next_required_fields?: string[];
  pending_confirmation?: ToolResultPendingConfirmation;
  message?: string;
  display_text?: string;
  errors?: ToolResultError[];
  affected?: ToolResultAffected[];
  v?: 1;
}

export interface BuildToolResultOptions<T> {
  status: ToolResultStatus;
  message?: string;
  data?: T;
  nextRequiredFields?: string[];
  pendingConfirmation?: ToolResultPendingConfirmation;
  displayText?: string;
  errors?: ToolResultError[];
  affected?: ToolResultAffected[];
}

export function buildToolResult<T = unknown>(
  opts: BuildToolResultOptions<T>,
): string {
  const payload: ToolResult<T> = {
    status: opts.status,
    v: 1,
  };
  if (opts.message) payload.message = opts.message;
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
  return JSON.stringify(payload);
}

export interface BuildLookupResultOptions<T> {
  result: LookupResult<T>;
  projectData?: (candidate: LookupCandidate<T>) => unknown;
  message?: string;
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
