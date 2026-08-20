/**
 * Grade semanal de funcionamento de uma clínica. As chaves seguem o índice de
 * `Date.getDay()` (0 = domingo), o que permite indexar direto pelo dia da data
 * escolhida na agenda. Dia com lista vazia = fechado.
 */
export const WEEKDAY_KEYS = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
] as const;

export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/** Bloco contínuo de atendimento. Horas em "HH:mm", 24h. */
export interface TimeBlock {
  start: string;
  end: string;
}

export type BusinessHours = Record<WeekdayKey, TimeBlock[]>;

/** Formato aceito para hora do dia. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Teto de blocos por dia — manhã, tarde, noite e uma folga. */
export const MAX_BLOCKS_PER_DAY = 4;
