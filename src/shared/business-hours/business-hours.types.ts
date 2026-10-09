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

export interface TimeBlock {
  start: string;
  end: string;
}

export type BusinessHours = Record<WeekdayKey, TimeBlock[]>;

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const MAX_BLOCKS_PER_DAY = 4;
