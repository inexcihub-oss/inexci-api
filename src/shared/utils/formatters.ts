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

/**
 * Data/hora de uma consulta em pt-BR, no fuso de São Paulo
 * (ex.: "sáb., 01/08 às 14:00").
 *
 * Compartilhado pelo lembrete e pela resposta do paciente no WhatsApp: o
 * horário que ele confirma tem de ser, letra por letra, o que ele recebeu.
 */
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

/** Campos de endereço da unidade de atendimento, todos opcionais na entidade. */
export interface EnderecoDaClinica {
  address: string | null;
  addressNumber: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

/**
 * Endereço da unidade em uma linha, para mensagens de texto livre no WhatsApp
 * (ex.: "Rua das Flores, 120 - Centro, São Paulo/SP").
 *
 * Cada pedaço só entra se existir — a clínica pode ter sido cadastrada pela
 * metade, e concatenar às cegas produzia ", - , /". Sem logradouro não há
 * endereço a mostrar, então devolve vazio e quem chama omite a linha.
 */
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
