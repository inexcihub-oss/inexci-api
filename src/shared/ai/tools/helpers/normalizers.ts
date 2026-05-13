/**
 * Funções de normalização de campos PII/formatados.
 * Fonte canônica — importar daqui; não definir localmente nas tools.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BIRTH_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normaliza telefone para somente dígitos (10–13).
 * Retorna `null` se inválido.
 */
export function normalizePhoneDigits(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) return null;
  return digits;
}

/**
 * Normaliza CPF para somente dígitos (11) com validação de DV.
 * Retorna `null` se inválido.
 */
export function normalizeCpfDigits(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length !== 11) return null;
  if (/^(\d)\1{10}$/.test(digits)) return null;
  const verifyDigit = (slice: string, factorStart: number): number => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      sum += Number(slice[i]) * (factorStart - i);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  const dv1 = verifyDigit(digits.slice(0, 9), 10);
  const dv2 = verifyDigit(digits.slice(0, 10), 11);
  if (dv1 !== Number(digits[9]) || dv2 !== Number(digits[10])) return null;
  return digits;
}

/**
 * Normaliza data de nascimento (AAAA-MM-DD).
 * Retorna `null` se inválida ou futura.
 */
export function normalizeBirthDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!BIRTH_DATE_REGEX.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  if (date.getTime() > Date.now()) return null;
  if (year < 1900) return null;
  return raw;
}

/**
 * Normaliza e-mail para letras minúsculas.
 * Retorna `null` se inválido.
 */
export function normalizeEmail(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (!EMAIL_REGEX.test(raw)) return null;
  return raw;
}

/**
 * Normaliza CPF sem validação de DV (versão simples, somente dígitos).
 * Usada quando a validação completa não é necessária (ex.: busca por CPF).
 */
export function normalizeCpfSimple(value: unknown): string | null {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length !== 11) return null;
  return digits;
}
