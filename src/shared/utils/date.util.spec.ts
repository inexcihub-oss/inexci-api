import { parseCalendarDate, todayCalendarDate } from './date.util';

describe('parseCalendarDate', () => {
  it('preserva o dia calendário para YYYY-MM-DD', () => {
    const date = parseCalendarDate('2026-06-10');
    expect(date.toISOString()).toBe('2026-06-10T12:00:00.000Z');
  });

  it('extrai a parte de data de ISO completo', () => {
    const date = parseCalendarDate('2026-06-10T00:00:00.000Z');
    expect(date.toISOString()).toBe('2026-06-10T12:00:00.000Z');
  });
});

describe('todayCalendarDate', () => {
  it('ancora o dia de São Paulo ao meio-dia UTC, mesmo de madrugada', () => {
    const now = new Date('2026-06-10T09:00:00.000Z');
    expect(todayCalendarDate(now).toISOString()).toBe(
      '2026-06-10T12:00:00.000Z',
    );
  });

  it('usa o dia de São Paulo quando em UTC já virou o dia seguinte', () => {
    const now = new Date('2026-06-11T01:30:00.000Z');
    expect(todayCalendarDate(now).toISOString()).toBe(
      '2026-06-10T12:00:00.000Z',
    );
  });
});
