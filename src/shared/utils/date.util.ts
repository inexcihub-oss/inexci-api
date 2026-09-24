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

/**
 * "Hoje" como data de calendário no fuso da clínica, ancorado no mesmo
 * meio-dia UTC de `parseCalendarDate` — para comparar dia com dia. Comparar
 * uma data de calendário com o instante atual (`Date.now()`) erra de manhã:
 * meio-dia UTC são 09:00 em São Paulo, e "hoje" pareceria futuro até lá.
 */
export function todayCalendarDate(
  now: Date = new Date(),
  timeZone = 'America/Sao_Paulo',
): Date {
  // en-CA formata como YYYY-MM-DD.
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parseCalendarDate(ymd);
}
