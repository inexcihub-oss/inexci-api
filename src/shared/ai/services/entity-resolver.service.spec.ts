import { EntityResolverService } from './entity-resolver.service';

interface FakeEntity {
  id: string;
  name: string;
}

describe('EntityResolverService', () => {
  let service: EntityResolverService;

  beforeEach(() => {
    service = new EntityResolverService();
  });

  const makeCandidates = (names: string[]): FakeEntity[] =>
    names.map((name, i) => ({ id: `id-${i + 1}`, name }));

  const resolve = (
    query: string,
    names: string[],
    opts: Partial<{
      resolveThreshold: number;
      candidateThreshold: number;
      minLeadOverNext: number;
      maxCandidates: number;
    }> = {},
  ) =>
    service.resolve<FakeEntity>({
      query,
      candidates: makeCandidates(names),
      getName: (c) => c.name,
      getId: (c) => c.id,
      ...opts,
    });

  describe('resolve()', () => {
    it('match exato após normalização → resolved com score 1', () => {
      const r = resolve('Beatriz Helena', ['Beatriz Helena', 'João Silva']);
      expect(r.status).toBe('resolved');
      expect(r.resolved?.label).toBe('Beatriz Helena');
      expect(r.resolved?.score).toBe(1);
    });

    it('ignora acentos: "Jose" casa "José"', () => {
      const r = resolve('Jose Silva', ['José Silva', 'Maria']);
      expect(r.status).toBe('resolved');
      expect(r.resolved?.label).toBe('José Silva');
    });

    it('typo curto em procedimento: "artoplastia" → "artroplastia"', () => {
      const r = resolve('artoplastia total do joelho', [
        'Artroplastia total do joelho',
        'Apendicectomia laparoscópica',
      ]);
      expect(r.status).toBe('resolved');
      expect(r.resolved?.label).toBe('Artroplastia total do joelho');
    });

    it('substring: "Beatriz Helena" casa "Beatriz Helena Santos" como resolved (uma só candidata, alta similaridade)', () => {
      const r = resolve('Beatriz Helena', [
        'Beatriz Helena Santos',
        'Fernando Augusto Costa',
      ]);
      expect(r.status).toBe('resolved');
      expect(r.resolved?.label).toBe('Beatriz Helena Santos');
    });

    it('palavra-a-palavra: "Albert Einstein" casa "Hospital Israelita Albert Einstein"', () => {
      const r = resolve('Albert Einstein', [
        'Hospital Israelita Albert Einstein',
        'Hospital Sírio-Libanês',
      ]);
      expect(r.status).toBe('resolved');
      expect(r.resolved?.label).toBe('Hospital Israelita Albert Einstein');
    });

    it('ambíguo: várias entradas com "Maria" sem destaque', () => {
      const r = resolve('Maria', [
        'Maria Silva',
        'Maria Souza',
        'Maria Santos',
        'Carlos Pereira',
      ]);
      expect(r.status).toBe('ambiguous');
      expect(r.candidates.length).toBeGreaterThanOrEqual(3);
    });

    it('not_found: nada acima do limiar', () => {
      const r = resolve('Joaquim Onofre', ['Maria Silva', 'Carlos Pereira']);
      expect(r.status).toBe('not_found');
      expect(r.candidates).toHaveLength(0);
    });

    it('query vazia retorna not_found', () => {
      const r = resolve('   ', ['Maria Silva']);
      expect(r.status).toBe('not_found');
    });

    it('respeita resolveThreshold custom', () => {
      const r = resolve('Bea', ['Beatriz Helena Santos', 'Beatriz Souza'], {
        resolveThreshold: 0.99,
      });
      // Forçando threshold alto, mesmo Bea→Beatriz Helena Santos vira ambíguo.
      expect(['ambiguous', 'not_found']).toContain(r.status);
    });

    it('aliases são considerados no matching', () => {
      const r = service.resolve<FakeEntity>({
        query: 'einstein',
        candidates: [
          { id: 'h1', name: 'Hospital Israelita Albert Einstein' },
          { id: 'h2', name: 'Hospital Sírio-Libanês' },
        ],
        getName: (c) => c.name,
        getId: (c) => c.id,
        getAliases: (c) => (c.id === 'h1' ? ['HIAE'] : []),
      });
      expect(r.status).toBe('resolved');
      expect(r.resolved?.id).toBe('h1');
    });
  });

  describe('score()', () => {
    it('exato após normalização → 1.0', () => {
      expect(service.score('jose', 'José')).toBe(1);
    });

    it('prefixo → entre 0.9 e 1', () => {
      const s = service.score('beatriz', 'Beatriz Helena Santos');
      expect(s).toBeGreaterThanOrEqual(0.9);
      expect(s).toBeLessThanOrEqual(1);
    });

    it('substring → entre 0.8 e 1', () => {
      const s = service.score('helena', 'Beatriz Helena Santos');
      expect(s).toBeGreaterThanOrEqual(0.8);
      expect(s).toBeLessThan(1);
    });

    it('completamente diferente → baixo', () => {
      const s = service.score('joao', 'maria');
      expect(s).toBeLessThan(0.6);
    });
  });

  describe('dice()', () => {
    it('strings idênticas → 1', () => {
      expect(service.dice('abc', 'abc')).toBe(1);
    });

    it('strings distintas → 0..1', () => {
      const v = service.dice('night', 'nacht');
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    });
  });

  describe('levenshteinNormalized()', () => {
    it('strings idênticas → 1', () => {
      expect(service.levenshteinNormalized('abc', 'abc')).toBe(1);
    });

    it('um caractere de diferença em string curta → < 1 mas alto', () => {
      const v = service.levenshteinNormalized('artoplastia', 'artroplastia');
      expect(v).toBeGreaterThan(0.85);
    });
  });
});
