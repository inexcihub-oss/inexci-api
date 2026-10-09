const OFFSET_MS = -3 * 60 * 60 * 1000;

export function instanteLocal(data: string, hora: string): Date {
  const [h, m, s] = hora.split(':');
  return new Date(`${data}T${h.padStart(2, '0')}:${m}:${s ?? '00'}-03:00`);
}

export function dataLocal(instante: Date): string {
  return new Date(instante.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export function minutosLocais(instante: Date): number {
  const d = new Date(instante.getTime() + OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function horaParaMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

export function diaDaSemana(data: string): number {
  return new Date(`${data}T12:00:00Z`).getUTCDay();
}

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

export function vigente(
  data: string,
  de: string | null,
  ate: string | null,
): boolean {
  return (!de || data >= de) && (!ate || data <= ate);
}
