export function maskPhone(value: string | null | undefined): string {
  if (!value) return '';
  const text = String(value);
  const digitsOnly = text.replace(/\D/g, '');
  if (digitsOnly.length < 5) return '***';
  const last4 = digitsOnly.slice(-4);
  let consumed = 0;
  const totalDigits = digitsOnly.length;
  return (
    text.replace(/\d/g, (digit) => {
      consumed += 1;
      if (consumed > totalDigits - 4) return digit;
      return '*';
    }) || `***${last4}`
  );
}

export function maskEmail(value: string | null | undefined): string {
  if (!value) return '';
  const text = String(value).trim();
  const at = text.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = text.slice(0, at);
  const domain = text.slice(at);
  if (local.length <= 1) return `${local}${domain}`;
  return `${local[0]}****${domain}`;
}

const EMAIL_IN_TEXT = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const DIGIT_RUN_IN_TEXT = /\+?\d[\d\s().-]{6,}\d/g;

export function maskSensitiveText(value: string): string {
  return value
    .replace(EMAIL_IN_TEXT, '***')
    .replace(DIGIT_RUN_IN_TEXT, '***')
    .replace(/\s+/g, ' ')
    .trim();
}

const IPV4_IN_TEXT = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}\b/g;
const IPV6_IN_TEXT =
  /\b([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::[0-9a-f]{0,4}){2,5}\b/gi;

export function maskIpAddresses(value: string): string {
  return value
    .replace(IPV4_IN_TEXT, '$1.$2.$3.x')
    .replace(IPV6_IN_TEXT, '$1:$2:$3::x');
}
