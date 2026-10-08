/**
 * Horário da agenda: grade e feriados são horários de parede de São Paulo.
 * Offset fixo de -03:00 — o Brasil não tem horário de verão desde 2019, e é a
 * mesma convenção do resto do backend (`formatAppointmentWhen`, importador).
 */
const OFFSET_MS = -3 * 60 * 60 * 1000;

/** `YYYY-MM-DD` + `HH:MM[:SS]` de São Paulo → instante. */
export function instanteLocal(data: string, hora: string): Date {
  const [h, m, s] = hora.split(':');
  return new Date(`${data}T${h.padStart(2, '0')}:${m}:${s ?? '00'}-03:00`);
}

/** Instante → `YYYY-MM-DD` em São Paulo. */
export function dataLocal(instante: Date): string {
  return new Date(instante.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutos desde a meia-noite de São Paulo. */
export function minutosLocais(instante: Date): number {
  const d = new Date(instante.getTime() + OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** `HH:MM[:SS]` → minutos. */
export function horaParaMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

/** 0 = domingo … 6 = sábado, da data de calendário. */
export function diaDaSemana(data: string): number {
  return new Date(`${data}T12:00:00Z`).getUTCDay();
}

/** Datas de `de` até `ate`, inclusive. */
export function datasEntre(de: string, ate: string): string[] {
  const datas: string[] = [];
  const fim = new Date(`${ate}T00:00:00Z`).getTime();
  for (
    let t = new Date(`${de}T00:00:00Z`).getTime();
    t <= fim;
    t += 24 * 60 * 60 * 1000
  ) {
    datas.push(new Date(t).toISOString().slice(0, 10));
  }
  return datas;
}

/** Uma data está dentro da vigência (limites nulos = abertos). */
export function vigente(
  data: string,
  de: string | null,
  ate: string | null,
): boolean {
  return (!de || data >= de) && (!ate || data <= ate);
}
