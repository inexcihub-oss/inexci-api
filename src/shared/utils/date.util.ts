export function parseCalendarDate(dateStr: string): Date {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
  }
  return new Date(dateStr);
}

export function todayCalendarDate(
  now: Date = new Date(),
  timeZone = 'America/Sao_Paulo',
): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parseCalendarDate(ymd);
}
