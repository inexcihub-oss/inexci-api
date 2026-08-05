const digitsOnly = (v: string): string => (v ? v.replace(/\D/g, '') : '');

export function formatPhone(v: string): string {
  const d = digitsOnly(v).slice(0, 11);
  if (d.length <= 10)
    return d.length > 6
      ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
      : d;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function formatCpf(v: string): string {
  const d = digitsOnly(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatCep(v: string): string {
  const d = digitsOnly(v).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function formatDateBR(v: string): string {
  if (!v) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return v;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return v;
}

/**
 * Reconhece um nome que já vem com tratamento médico ("Dr. Carlos",
 * "Dra. Ana", "Dr(a). Paulo"). O ponto é opcional e o espaço é obrigatório —
 * sem ele, "Drauzio" seria confundido com "Dra".
 */
const DOCTOR_TITLE_PREFIX = /^(dr|dra|dr\(a\))\.?\s/i;

/**
 * Nome do médico com o tratamento na frente, sem duplicar o que já existe.
 *
 * Muito cadastro guarda o nome já como "Dr. Carlos Mendonça"; prefixar às
 * cegas produzia "Dr(a). Dr. Carlos Mendonça" na tela e no e-mail de lembrete.
 */
export function formatDoctorName(name?: string | null): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '';
  return DOCTOR_TITLE_PREFIX.test(trimmed) ? trimmed : `Dr(a). ${trimmed}`;
}
