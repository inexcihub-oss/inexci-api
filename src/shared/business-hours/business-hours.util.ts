import {
  BusinessHours,
  MAX_BLOCKS_PER_DAY,
  TIME_PATTERN,
  TimeBlock,
  WEEKDAY_KEYS,
  WeekdayKey,
} from './business-hours.types';

export * from './business-hours.types';

export function emptyBusinessHours(): BusinessHours {
  return WEEKDAY_KEYS.reduce((grade, dia) => {
    grade[dia] = [];
    return grade;
  }, {} as BusinessHours);
}

export function toMinutes(time: string): number {
  const [hh, mm] = time.split(':').map(Number);
  return hh * 60 + mm;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeBusinessHours(raw: unknown): BusinessHours {
  const grade = emptyBusinessHours();
  if (!isRecord(raw)) return grade;

  for (const dia of WEEKDAY_KEYS) {
    const blocos = raw[dia];
    if (!Array.isArray(blocos)) continue;
    grade[dia] = blocos
      .filter(
        (bloco): bloco is TimeBlock =>
          isRecord(bloco) &&
          typeof bloco.start === 'string' &&
          typeof bloco.end === 'string',
      )
      .map((bloco) => ({ start: bloco.start, end: bloco.end }));
  }

  return grade;
}

export function validateBusinessHours(raw: unknown): string | null {
  if (!isRecord(raw)) return 'Grade de horários inválida.';

  for (const chave of Object.keys(raw)) {
    if (!WEEKDAY_KEYS.includes(chave as WeekdayKey)) {
      return `Dia inválido na grade de horários: "${chave}".`;
    }

    const blocos = raw[chave];
    if (!Array.isArray(blocos)) {
      return `Os horários de "${chave}" devem ser uma lista de blocos.`;
    }
    if (blocos.length > MAX_BLOCKS_PER_DAY) {
      return `Máximo de ${MAX_BLOCKS_PER_DAY} blocos de horário por dia em "${chave}".`;
    }

    for (const bloco of blocos) {
      if (
        !isRecord(bloco) ||
        typeof bloco.start !== 'string' ||
        typeof bloco.end !== 'string' ||
        !TIME_PATTERN.test(bloco.start) ||
        !TIME_PATTERN.test(bloco.end)
      ) {
        return `Horário inválido em "${chave}": use o formato HH:mm.`;
      }
      if (toMinutes(bloco.start) >= toMinutes(bloco.end)) {
        return `Em "${chave}", o horário inicial deve ser menor que o final.`;
      }
    }

    const ordenados = [...(blocos as TimeBlock[])].sort(
      (a, b) => toMinutes(a.start) - toMinutes(b.start),
    );
    for (let i = 1; i < ordenados.length; i++) {
      if (toMinutes(ordenados[i].start) < toMinutes(ordenados[i - 1].end)) {
        return `Há blocos de horário sobrepostos em "${chave}".`;
      }
    }
  }

  return null;
}
