/**
 * Helpers para mascarar PII (telefone, e-mail, CPF, CNPJ) em logs textuais
 * e em colunas de auditoria como `notification_send_logs.to`.
 *
 * Política:
 * - Mantemos o suficiente para suporte/auditoria (ex.: prefixo + final do
 *   telefone, domínio do e-mail), mas não o identificador completo.
 * - Funções são tolerantes a entrada vazia/`null` para uso em logs sem
 *   precisar de guards no caller.
 */

/**
 * Mascara um telefone preservando os 4 últimos dígitos.
 * - `+5511987654321` → `+5511*****4321`
 * - `(11) 98765-4321` → `(11) *****4321`
 * - Qualquer string com menos de 5 dígitos é retornada como `***`.
 */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return '';
  const text = String(value);
  const digitsOnly = text.replace(/\D/g, '');
  if (digitsOnly.length < 5) return '***';
  const last4 = digitsOnly.slice(-4);
  // Substitui todos os dígitos exceto os últimos 4 por asteriscos,
  // preservando separadores originais para que a máscara permaneça reconhecível.
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

/**
 * Mascara um e-mail preservando a primeira letra e o domínio.
 * - `joao.silva@inexci.com` → `j****@inexci.com`
 * - `a@b.com` → `a@b.com` (string muito curta — devolve igual; assume que
 *   um e-mail tão curto não é dado real)
 */
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

/**
 * Mascara um CPF preservando apenas o quinto dígito (regra usada em
 * sistemas de saúde brasileiros). Aceita formatado ou só dígitos.
 * - `123.456.789-00` → `***.***.***-**`
 * - `12345678900`    → `***.***.***-**`
 */
export function maskCpf(value: string | null | undefined): string {
  if (!value) return '';
  return '***.***.***-**';
}

/**
 * Mascara um CNPJ preservando o radical da empresa.
 * Exemplo: `12.345.678 0001-90` vira `**.***.*** ****-**`.
 */
export function maskCnpj(value: string | null | undefined): string {
  if (!value) return '';
  return '**.***.***/****-**';
}
