/**
 * Helpers para enxugar conteúdo persistido em tabelas de log
 * (`notification_send_logs`, etc.) e em logs textuais.
 *
 * Mantém os logs auditáveis sem inflar o banco com payloads gigantes
 * (respostas longas da IA, stack traces inteiros, vars de template).
 */

const DEFAULT_MAX_CHARS = 500;

/**
 * Trunca uma string para `maxChars` caracteres, anexando o sufixo
 * `…[truncated:N]` quando há corte. Retorna `null` se a entrada for vazia
 * para preservar o comportamento de coluna nullable.
 */
export function truncateForLog(
  value: string | null | undefined,
  maxChars: number = DEFAULT_MAX_CHARS,
): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!text) return null;
  if (text.length <= maxChars) return text;
  const removed = text.length - maxChars;
  return `${text.slice(0, maxChars)}…[truncated:${removed}]`;
}

/**
 * Trunca a `error.message` (ou string) preservando uma indicação de overflow.
 * Não inclui stack — se o caller quiser stack, deve serializar manualmente
 * antes (e ainda assim a coluna no DB tem hard limit em VARCHAR(600)).
 */
export function truncateErrorForLog(
  err: unknown,
  maxChars: number = DEFAULT_MAX_CHARS,
): string | null {
  if (err === null || err === undefined) return null;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })();
  return truncateForLog(message, maxChars);
}
