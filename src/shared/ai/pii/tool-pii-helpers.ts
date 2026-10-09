import { PiiCategory } from '../services/pii-vault.service';
import { ToolContext } from '../tools/tool.interface';
import {
  PiiAllowlistViolationError,
  isCategoryAllowedForTool,
} from './tool-pii-allowlist';

const PLACEHOLDER_REGEX = /\{\{[a-z_]+_\d+\}\}/g;

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

export function detokenizeArg(
  context: ToolContext,
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const stringValue = String(value);
  if (!stringValue) return '';
  if (!context.piiVault) return stringValue;
  PLACEHOLDER_REGEX.lastIndex = 0;
  if (!PLACEHOLDER_REGEX.test(stringValue)) return stringValue;
  return context.piiVault.detokenize(context.conversationId, stringValue);
}

export function containsPlaceholder(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  PLACEHOLDER_REGEX.lastIndex = 0;
  return PLACEHOLDER_REGEX.test(value);
}
