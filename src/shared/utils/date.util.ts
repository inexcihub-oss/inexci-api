/**
 * Converte string de data de calendário (YYYY-MM-DD ou ISO) para Date
 * usando meio-dia UTC, evitando deslocamento de dia por fuso horário.
 */
export function parseCalendarDate(dateStr: string): Date {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
  }
  return new Date(dateStr);
}
