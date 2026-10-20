import {
  isFuzzyMatch,
  levenshteinDistance,
  normalizeNameForCompare,
} from './catalog.helpers';

describe('catalog.helpers', () => {
  describe('normalizeNameForCompare', () => {
    it.each([
      ['Unimed', 'unimed'],
      ['UNIMED', 'unimed'],
      ['  Unimédio  ', 'unimedio'],
      ['Sírio-Libanês', 'sirio-libanes'],
      ['Albert  Einstein', 'albert einstein'],
    ])('"%s" → "%s"', (input, expected) => {
      expect(normalizeNameForCompare(input)).toBe(expected);
    });
  });

  describe('levenshteinDistance', () => {
    it.each([
      ['', '', 0],
      ['abc', 'abc', 0],
      ['unimed', 'unimedia', 2],
      ['unimed', 'unimedio', 2],
      ['unimedia', 'unimedio', 1],
      ['einstein', 'einstien', 2],
    ])('d("%s","%s") = %i', (a, b, expected) => {
      expect(levenshteinDistance(a, b)).toBe(expected);
    });
  });

  describe('isFuzzyMatch', () => {
    it('reconhece variações de "Unimed"', () => {
      expect(isFuzzyMatch('unimed', 'unimedia')).toBe(true);
      expect(isFuzzyMatch('unimed', 'unimedio')).toBe(true);
      expect(isFuzzyMatch('unimedia', 'unimedio')).toBe(true);
    });

    it('NÃO casa strings muito diferentes', () => {
      expect(isFuzzyMatch('unimed', 'amil')).toBe(false);
      expect(isFuzzyMatch('unimed', 'bradesco saude')).toBe(false);
      expect(isFuzzyMatch('einstein', 'hospital')).toBe(false);
    });

    it('para strings curtas (<=3 chars) exige igualdade', () => {
      expect(isFuzzyMatch('ab', 'ac')).toBe(false);
      expect(isFuzzyMatch('ab', 'ab')).toBe(true);
    });
  });
});
