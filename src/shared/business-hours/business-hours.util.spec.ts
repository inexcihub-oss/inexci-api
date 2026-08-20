import {
  emptyBusinessHours,
  normalizeBusinessHours,
  toMinutes,
  validateBusinessHours,
} from './business-hours.util';

describe('business-hours.util', () => {
  describe('toMinutes', () => {
    it('converte HH:mm em minutos desde a meia-noite', () => {
      expect(toMinutes('00:00')).toBe(0);
      expect(toMinutes('08:30')).toBe(510);
      expect(toMinutes('23:59')).toBe(1439);
    });
  });

  describe('normalizeBusinessHours', () => {
    it('preenche os sete dias, mesmo quando o objeto vem vazio', () => {
      expect(normalizeBusinessHours({})).toEqual(emptyBusinessHours());
    });

    it('mantém os blocos informados e zera os dias ausentes', () => {
      const grade = normalizeBusinessHours({
        mon: [{ start: '08:00', end: '12:00' }],
      });
      expect(grade.mon).toEqual([{ start: '08:00', end: '12:00' }]);
      expect(grade.tue).toEqual([]);
    });

    it('devolve grade vazia para entrada que não é objeto', () => {
      expect(normalizeBusinessHours(null)).toEqual(emptyBusinessHours());
      expect(normalizeBusinessHours('seg 8h')).toEqual(emptyBusinessHours());
    });

    it('descarta chave desconhecida em vez de propagá-la', () => {
      const grade = normalizeBusinessHours({
        segunda: [{ start: '08:00', end: '12:00' }],
      });
      expect(grade).toEqual(emptyBusinessHours());
      expect('segunda' in grade).toBe(false);
    });
  });

  describe('validateBusinessHours', () => {
    it('aceita grade vazia', () => {
      expect(validateBusinessHours({})).toBeNull();
    });

    it('aceita dois blocos no mesmo dia com intervalo de almoço', () => {
      expect(
        validateBusinessHours({
          mon: [
            { start: '08:00', end: '12:00' },
            { start: '14:00', end: '18:00' },
          ],
        }),
      ).toBeNull();
    });

    it('recusa entrada que não é objeto', () => {
      expect(validateBusinessHours(null)).toBe('Grade de horários inválida.');
      expect(validateBusinessHours([])).toBe('Grade de horários inválida.');
    });

    it('recusa dia desconhecido', () => {
      expect(validateBusinessHours({ segunda: [] })).toBe(
        'Dia inválido na grade de horários: "segunda".',
      );
    });

    it('recusa dia cujo valor não é lista', () => {
      expect(validateBusinessHours({ mon: '08:00-12:00' })).toBe(
        'Os horários de "mon" devem ser uma lista de blocos.',
      );
    });

    it('recusa hora fora do formato HH:mm', () => {
      expect(
        validateBusinessHours({ mon: [{ start: '8:00', end: '12:00' }] }),
      ).toBe('Horário inválido em "mon": use o formato HH:mm.');
      expect(
        validateBusinessHours({ mon: [{ start: '24:00', end: '25:00' }] }),
      ).toBe('Horário inválido em "mon": use o formato HH:mm.');
    });

    it('recusa bloco cujo início não é menor que o fim', () => {
      expect(
        validateBusinessHours({ mon: [{ start: '12:00', end: '12:00' }] }),
      ).toBe('Em "mon", o horário inicial deve ser menor que o final.');
      expect(
        validateBusinessHours({ mon: [{ start: '18:00', end: '09:00' }] }),
      ).toBe('Em "mon", o horário inicial deve ser menor que o final.');
    });

    it('recusa blocos sobrepostos no mesmo dia, em qualquer ordem', () => {
      expect(
        validateBusinessHours({
          mon: [
            { start: '08:00', end: '12:00' },
            { start: '11:00', end: '15:00' },
          ],
        }),
      ).toBe('Há blocos de horário sobrepostos em "mon".');
      expect(
        validateBusinessHours({
          mon: [
            { start: '14:00', end: '18:00' },
            { start: '08:00', end: '15:00' },
          ],
        }),
      ).toBe('Há blocos de horário sobrepostos em "mon".');
    });

    it('aceita blocos encostados (fim de um igual ao início do outro)', () => {
      expect(
        validateBusinessHours({
          mon: [
            { start: '08:00', end: '12:00' },
            { start: '12:00', end: '18:00' },
          ],
        }),
      ).toBeNull();
    });

    it('recusa mais de quatro blocos no mesmo dia', () => {
      expect(
        validateBusinessHours({
          mon: [
            { start: '07:00', end: '08:00' },
            { start: '09:00', end: '10:00' },
            { start: '11:00', end: '12:00' },
            { start: '13:00', end: '14:00' },
            { start: '15:00', end: '16:00' },
          ],
        }),
      ).toBe('Máximo de 4 blocos de horário por dia em "mon".');
    });
  });
});
