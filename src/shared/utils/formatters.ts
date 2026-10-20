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

export function todayBR(
  now: Date = new Date(),
  timeZone = 'America/Sao_Paulo',
): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now);
}

const DOCTOR_TITLE_PREFIX = /^(dr|dra|dr\(a\))\.?\s/i;

export function formatDoctorName(name?: string | null): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '';
  return DOCTOR_TITLE_PREFIX.test(trimmed) ? trimmed : `Dr(a). ${trimmed}`;
}

export function formatAppointmentWhen(date: Date): string {
  const day = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
  const time = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
  return `${day} às ${time}`;
}

export interface EnderecoDaClinica {
  address: string | null;
  addressNumber: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

export function formatClinicAddress(
  clinic: EnderecoDaClinica | null | undefined,
): string {
  const logradouro = clinic?.address?.trim();
  if (!logradouro) return '';

  let linha = logradouro;
  if (clinic?.addressNumber?.trim()) {
    linha += `, ${clinic.addressNumber.trim()}`;
  }
  if (clinic?.neighborhood?.trim()) {
    linha += ` - ${clinic.neighborhood.trim()}`;
  }

  const cidade = clinic?.city?.trim();
  const uf = clinic?.state?.trim();
  if (cidade) {
    linha += `, ${cidade}${uf ? `/${uf}` : ''}`;
  }

  return linha;
}
