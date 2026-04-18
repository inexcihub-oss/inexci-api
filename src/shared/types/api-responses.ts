/**
 * Convenção de respostas padronizadas da API.
 *
 * REGRAS:
 * 1. Queries (GET) → retornam a entidade ou lista de entidades
 * 2. Mutations que criam/atualizam → retornam a entidade criada/atualizada
 * 3. Mutations void (delete, mark as read, etc.) → retornam { message: string }
 * 4. Operações com envio (email/PDF) → retornam { sent: boolean, method?: string }
 *
 * NUNCA misturar padrões no mesmo tipo de operação.
 */

/** Resposta padrão para operações que não retornam entidade */
export interface MessageResponse {
  message: string;
}

/** Resposta padrão para operações de envio */
export interface SendResponse {
  sent: boolean;
  method?: string;
}

/** Resposta paginada padrão */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
