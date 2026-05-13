import { TussService } from './tuss.service';

/**
 * Os testes carregam o `tuss.json` real do diretório `src/utils/`. Os
 * códigos abaixo foram escolhidos por estarem garantidos no arquivo
 * (verificados manualmente):
 *
 *   - 30713153 → "Artroscopia para diagnóstico com ou sem biópsia sinovial"
 *   - 30401011 → "Biópsia de pavilhão auricular"
 *   - 10101012 → "Consulta em consultório (no horário normal ou preestabelecido)"
 *
 * O `formatTussCode` interno mantém compatibilidade com o formato exposto ao
 * frontend (10 dígitos formatados como `XX.XX.XX.XXX-X`). Por isso comparamos
 * apenas pelos dígitos quando precisamos validar identidade do código.
 */
const onlyDigits = (code: string): string => code.replace(/\D/g, '');

describe('TussService', () => {
  const service = new TussService();

  describe('search() — controller HTTP', () => {
    it('retorna lista paginada quando search é vazio', () => {
      const result = service.search(undefined, 5);
      expect(result).toHaveLength(5);
      expect(result[0]).toHaveProperty('tussCode');
      expect(result[0]).toHaveProperty('name');
      expect(result[0].active).toBe(true);
    });

    it('respeita o limite informado', () => {
      const result = service.search(undefined, 2);
      expect(result).toHaveLength(2);
    });

    it('encontra por descrição parcial (sem acento)', () => {
      const result = service.search('biopsia', 10);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((item) => /biópsia|biopsia/i.test(item.name))).toBe(
        true,
      );
    });
  });

  describe('lookup() — IA do WhatsApp', () => {
    it('encontra por código completo sem máscara', () => {
      const result = service.lookup('30713153', 5);
      expect(result.length).toBeGreaterThan(0);
      expect(onlyDigits(result[0].tussCode)).toBe('0030713153');
      expect(result[0].name).toContain('Artroscopia');
    });

    it('encontra por código completo com máscara informada pelo usuário', () => {
      const result = service.lookup('3.07.13.15-3', 5);
      expect(onlyDigits(result[0].tussCode)).toBe('0030713153');
      expect(result[0].name).toContain('Artroscopia');
    });

    it('encontra por prefixo de código (parcial)', () => {
      const result = service.lookup('307131', 10);
      expect(result.length).toBeGreaterThan(0);
      expect(
        result.every((item) => onlyDigits(item.tussCode).includes('307131')),
      ).toBe(true);
    });

    it('encontra por descrição completa (sem acento)', () => {
      const result = service.lookup(
        'Artroscopia para diagnostico com ou sem biopsia sinovial',
        5,
      );
      expect(onlyDigits(result[0].tussCode)).toBe('0030713153');
    });

    it('encontra por descrição parcial (uma palavra)', () => {
      const result = service.lookup('artroscopia', 10);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((item) => /artroscopia/i.test(item.name))).toBe(true);
    });

    it('encontra quando o usuário fala palavras fora de ordem', () => {
      const result = service.lookup('sinovial artroscopia', 5);
      expect(
        result.some((item) => onlyDigits(item.tussCode) === '0030713153'),
      ).toBe(true);
    });

    it('coloca o match exato (código completo) na primeira posição', () => {
      const result = service.lookup('30401011', 5);
      expect(onlyDigits(result[0].tussCode)).toBe('0030401011');
      expect(result[0].name).toContain('Biópsia de pavilhão auricular');
    });

    it('retorna lista vazia para query muito curta ou inválida', () => {
      expect(service.lookup('', 5)).toEqual([]);
      expect(service.lookup('   ', 5)).toEqual([]);
    });

    it('respeita o limite e ordena resultados de forma determinística', () => {
      const a = service.lookup('biopsia', 5);
      const b = service.lookup('biopsia', 5);
      expect(a).toHaveLength(5);
      expect(a.map((r) => r.tussCode)).toEqual(b.map((r) => r.tussCode));
    });
  });

  describe('findByExactCode()', () => {
    it('encontra com código sem máscara', () => {
      const result = service.findByExactCode('30713153');
      expect(result).not.toBeNull();
      expect(onlyDigits(result!.tussCode)).toBe('0030713153');
    });

    it('encontra com código com máscara', () => {
      const result = service.findByExactCode('3.07.13.15-3');
      expect(result).not.toBeNull();
      expect(onlyDigits(result!.tussCode)).toBe('0030713153');
    });

    it('retorna null quando o código não existe', () => {
      expect(service.findByExactCode('99999999')).toBeNull();
    });

    it('retorna null para entrada vazia ou sem dígitos', () => {
      expect(service.findByExactCode('')).toBeNull();
      expect(service.findByExactCode('abc')).toBeNull();
    });
  });
});
