import { maskSensitiveText } from 'src/shared/utils/mask.util';

export function maskRecipient(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '—';
  if (raw.includes('@')) {
    const at = raw.lastIndexOf('@');
    const local = raw.slice(0, at);
    const domain = raw.slice(at + 1);
    return `${local.slice(0, 1)}***@${domain}`;
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 12 && digits.startsWith('55')) {
    const ddd = digits.slice(2, 4);
    const first = digits.charAt(4);
    return `+55 ${ddd} ${first}****-${digits.slice(-4)}`;
  }
  if (digits.length >= 4) return `****${digits.slice(-4)}`;
  return '****';
}

export function sanitizeDeliveryError(
  value: string | null | undefined,
): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const clean = maskSensitiveText(raw);
  return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean;
}
