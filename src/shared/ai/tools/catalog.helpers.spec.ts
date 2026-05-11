import {
  findOwnedByNormalizedName,
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

  describe('findOwnedByNormalizedName — fuzzy fallback', () => {
    it('acha "Unimed" quando o banco tem "Unimédio"', async () => {
      const repo = {
        findOne: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          { id: 'hp-1', name: 'Bradesco Saúde', ownerId: 'o1' },
          { id: 'hp-2', name: 'Unimédio', ownerId: 'o1' },
          { id: 'hp-3', name: 'Amil', ownerId: 'o1' },
        ]),
      };

      const result = await findOwnedByNormalizedName(repo, 'Unimed', 'o1');

      expect(result?.id).toBe('hp-2');
      expect(result?.name).toBe('Unimédio');
    });

    it('acha "Albert Einstein" quando o banco tem "Hospital Israelita Albert Einstein"', async () => {
      const repo = {
        findOne: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          { id: 'h-1', name: 'Hospital Sírio-Libanês', ownerId: 'o1' },
          {
            id: 'h-2',
            name: 'Hospital Israelita Albert Einstein',
            ownerId: 'o1',
          },
        ]),
      };

      const result = await findOwnedByNormalizedName(
        repo,
        'Albert Einstein',
        'o1',
      );

      // Match parcial (substring) já pega esse caso — fuzzy é fallback.
      expect(result?.id).toBe('h-2');
    });

    it('volta NULL quando nenhum candidato é similar o suficiente', async () => {
      const repo = {
        findOne: jest.fn().mockResolvedValue(null),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'h-1', name: 'Hospital Bradesco', ownerId: 'o1' },
          ]),
      };

      const result = await findOwnedByNormalizedName(
        repo,
        'Albert Einstein',
        'o1',
      );

      expect(result).toBeNull();
    });

    it('prefere match exato a qualquer fallback fuzzy', async () => {
      const repo = {
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 'h-exact', name: 'Unimed', ownerId: 'o1' }),
        findMany: jest.fn(),
      };

      const result = await findOwnedByNormalizedName(repo, 'Unimed', 'o1');
      expect(result?.id).toBe('h-exact');
      expect(repo.findMany).not.toHaveBeenCalled();
    });
  });
});
