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

export function maskCpf(value: string | null | undefined): string {
  if (!value) return '';
  return '***.***.***-**';
}

export function maskCnpj(value: string | null | undefined): string {
  if (!value) return '';
  return '**.***.***/****-**';
}
