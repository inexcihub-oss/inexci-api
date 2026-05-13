import { CidService } from './cid.service';

/**
 * Os testes carregam o `cid.json` real do diretório `src/utils/`. Códigos
 * usados (verificados manualmente no arquivo):
 *
 *   - A00  → "Cólera"
 *   - A001 → "Cólera Devida a Vibrio Cholerae 01, Biótipo El Tor"
 *   - M17  → "Gonartrose (artrose do Joelho)"
 *   - M170 → "Gonartrose Primária Bilateral"
 *   - M171 → "Outras Gonartroses Primárias"
 */
describe('CidService', () => {
  const service = new CidService();

  describe('findAll() — controller HTTP', () => {
    it('retorna paginação com total e records quando search é vazio', () => {
      const result = service.findAll({ skip: 0, take: 5 });
      expect(result.total).toBeGreaterThan(0);
      expect(result.records).toHaveLength(5);
      expect(result.records[0]).toHaveProperty('code');
      expect(result.records[0]).toHaveProperty('description');
    });

    it('respeita skip e take', () => {
      const first = service.findAll({ skip: 0, take: 3 });
      const second = service.findAll({ skip: 3, take: 3 });
      expect(first.records).toHaveLength(3);
      expect(second.records).toHaveLength(3);
      expect(first.records[0].code).not.toBe(second.records[0].code);
    });

    it('encontra por descrição parcial (sem acento)', () => {
      const result = service.findAll({ search: 'colera', skip: 0, take: 10 });
      expect(result.total).toBeGreaterThan(0);
      expect(
        result.records.every((item) => /cólera|colera/i.test(item.description)),
      ).toBe(true);
    });
  });

  describe('lookup() — IA do WhatsApp', () => {
    it('encontra por código completo sem ponto', () => {
      const result = service.lookup('M171', 5);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].code).toBe('M171');
      expect(result[0].description).toContain('Gonartroses Primárias');
    });

    it('encontra por código completo com ponto (M17.1)', () => {
      const result = service.lookup('M17.1', 5);
      expect(result[0].code).toBe('M171');
    });

    it('encontra por prefixo de código (M17 retorna a categoria + filhos)', () => {
      const result = service.lookup('M17', 10);
      expect(result.length).toBeGreaterThan(1);
      // O match exato de "M17" deve vir primeiro.
      expect(result[0].code).toBe('M17');
      expect(
        result.every((item) => item.code.toUpperCase().startsWith('M17')),
      ).toBe(true);
    });

    it('encontra por descrição parcial (uma palavra)', () => {
      const result = service.lookup('gonartrose', 10);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((item) => /gonartrose/i.test(item.description))).toBe(
        true,
      );
    });

    it('encontra por descrição completa (sem acento)', () => {
      const result = service.lookup('Gonartrose Primaria Bilateral', 5);
      expect(result[0].code).toBe('M170');
    });

    it('encontra quando o usuário fala palavras fora de ordem', () => {
      const result = service.lookup('joelho artrose', 10);
      expect(result.some((item) => /joelho/i.test(item.description))).toBe(
        true,
      );
    });

    it('coloca o match exato na primeira posição', () => {
      const result = service.lookup('A001', 5);
      expect(result[0].code).toBe('A001');
      expect(result[0].description).toContain('Vibrio Cholerae');
    });

    it('retorna lista vazia para query muito curta ou inválida', () => {
      expect(service.lookup('', 5)).toEqual([]);
      expect(service.lookup('   ', 5)).toEqual([]);
    });

    it('respeita o limite e ordena resultados de forma determinística', () => {
      const a = service.lookup('artrose', 5);
      const b = service.lookup('artrose', 5);
      expect(a).toHaveLength(5);
      expect(a.map((r) => r.code)).toEqual(b.map((r) => r.code));
    });
  });

  describe('findByExactCode()', () => {
    it('encontra com código sem ponto', () => {
      const result = service.findByExactCode('M171');
      expect(result?.code).toBe('M171');
    });

    it('encontra com código com ponto (M17.1)', () => {
      const result = service.findByExactCode('M17.1');
      expect(result?.code).toBe('M171');
    });

    it('encontra com letra minúscula', () => {
      const result = service.findByExactCode('m171');
      expect(result?.code).toBe('M171');
    });

    it('retorna null quando o código não existe', () => {
      expect(service.findByExactCode('Z9999')).toBeNull();
    });

    it('retorna null para entrada vazia ou descrição (não é código CID)', () => {
      expect(service.findByExactCode('')).toBeNull();
      expect(service.findByExactCode('artrose')).toBeNull();
      expect(service.findByExactCode('123')).toBeNull();
    });
  });
});
