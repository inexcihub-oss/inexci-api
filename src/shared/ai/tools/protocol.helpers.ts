import { argToString } from './helpers/arg-parsers';

export function stripScPrefix(protocol: unknown): string {
  let value = argToString(protocol ?? '').trim();
  if (!value) return '';
  while (/^sc-/i.test(value)) {
    value = value.replace(/^sc-/i, '').trim();
  }
  return value;
}

export function formatScProtocolForDisplay(protocol: unknown): string {
  const stripped = stripScPrefix(protocol);
  if (!stripped) return 'SC-N/D';
  return `SC-${stripped.toUpperCase()}`;
}

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

export function collapseDuplicatedScPrefixes(text: string): string {
  if (!text) return text || '';
  return text.replace(/(?:SC-){2,}(?=[\w{])/gi, (match) => match.slice(0, 3));
}
