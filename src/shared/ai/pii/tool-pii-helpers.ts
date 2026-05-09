import { PiiCategory } from '../services/pii-vault.service';
import { ToolContext } from '../tools/tool.interface';
import {
  PiiAllowlistViolationError,
  isCategoryAllowedForTool,
} from './tool-pii-allowlist';

const PLACEHOLDER_REGEX = /\{\{[a-z_]+_\d+\}\}/g;

/**
 * Tokeniza um valor pelo `PiiVaultService` da sessão atual respeitando a
 * allowlist de PII por tool. Devolve string vazia para valores nulos.
 *
 * Comportamentos:
 * - Sem vault no contexto (ex.: testes legados): devolve o valor cru. NÃO é
 *   um caminho seguro para produção; o orchestrator garante que sempre haja vault.
 * - Categoria proibida para a tool: lança `PiiAllowlistViolationError`. Falhar alto
 *   em desenvolvimento é melhor que vazar PII silenciosamente em produção.
 */
export function tokenizePii(
  context: ToolContext,
  toolName: string,
  category: PiiCategory,
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return '';
  const stringValue = String(value).trim();
  if (!stringValue) return '';

  if (!isCategoryAllowedForTool(toolName, category)) {
    throw new PiiAllowlistViolationError(toolName, category);
  }

  if (!context.piiVault) return stringValue;
  return context.piiVault.tokenize(
    context.conversationId,
    stringValue,
    category,
  );
}

/**
 * Versão leniente: usada quando a tool não conhece a categoria com certeza
 * (ex.: catálogo polimórfico). Se a categoria não for permitida, devolve o
 * valor mascarado em vez de falhar.
 */
export function tokenizeOrMask(
  context: ToolContext,
  toolName: string,
  category: PiiCategory,
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return '';
  const stringValue = String(value).trim();
  if (!stringValue) return '';

  if (!isCategoryAllowedForTool(toolName, category)) {
    return '[REDACTED]';
  }

  if (!context.piiVault) return stringValue;
  return context.piiVault.tokenize(
    context.conversationId,
    stringValue,
    category,
  );
}

/**
 * Detokeniza placeholders em um valor recebido pela IA antes de persistir
 * no banco de dados. Necessário para tools de mutação que aceitam conteúdo
 * sensível: a IA opera sobre placeholders mas o DB precisa do valor real.
 */
export function detokenizeArg(
  context: ToolContext,
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const stringValue = String(value);
  if (!stringValue) return '';
  if (!context.piiVault) return stringValue;
  // PLACEHOLDER_REGEX é global; sem reset do lastIndex, chamadas
  // consecutivas em strings diferentes podiam retornar `false` por causa
  // de leftover do match anterior — pulando indevidamente o detokenize.
  PLACEHOLDER_REGEX.lastIndex = 0;
  if (!PLACEHOLDER_REGEX.test(stringValue)) return stringValue;
  return context.piiVault.detokenize(context.conversationId, stringValue);
}

/**
 * Verifica se um valor contém apenas placeholders (útil para validações
 * antes de propagar para integrações externas que não aceitam texto vazio).
 */
export function containsPlaceholder(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  PLACEHOLDER_REGEX.lastIndex = 0;
  return PLACEHOLDER_REGEX.test(value);
}
