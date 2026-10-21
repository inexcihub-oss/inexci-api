export const FUSO_FINANCEIRO = 'America/Sao_Paulo';

export function dataEmSaoPaulo(data: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_FINANCEIRO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(data);
}

export function dataHoraEmSaoPaulo(data: Date | string | null): string {
  if (!data) return '';
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO_FINANCEIRO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(data));
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((parte) => parte.type === tipo)?.value ?? '';
  return `${valor('day')}/${valor('month')}/${valor('year')} ${valor('hour')}:${valor('minute')}`;
}
