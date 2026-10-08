import {
  dataLocal,
  datasEntre,
  diaDaSemana,
  horaParaMinutos,
  instanteLocal,
  minutosLocais,
  vigente,
} from './agenda-time';

describe('agenda-time', () => {
  it('converte horário de São Paulo para instante e volta', () => {
    const i = instanteLocal('2026-10-05', '08:30');
    expect(i.toISOString()).toBe('2026-10-05T11:30:00.000Z');
    expect(dataLocal(i)).toBe('2026-10-05');
    expect(minutosLocais(i)).toBe(510);
  });

  it('22h em São Paulo ainda é o mesmo dia local (já é o dia seguinte em UTC)', () => {
    const i = instanteLocal('2026-10-05', '22:00:00');
    expect(i.toISOString()).toBe('2026-10-06T01:00:00.000Z');
    expect(dataLocal(i)).toBe('2026-10-05');
  });

  it('dia da semana, intervalo de datas e minutos', () => {
    expect(diaDaSemana('2026-10-04')).toBe(0); // domingo
    expect(diaDaSemana('2026-10-10')).toBe(6); // sábado
    expect(datasEntre('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(horaParaMinutos('13:45:00')).toBe(825);
  });

  it('vigência com limites abertos', () => {
    expect(vigente('2026-01-01', null, null)).toBe(true);
    expect(vigente('2026-01-01', '2026-01-02', null)).toBe(false);
    expect(vigente('2026-01-01', null, '2026-01-01')).toBe(true);
  });
});
