import { parseCalendarDate } from './date.util';

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
