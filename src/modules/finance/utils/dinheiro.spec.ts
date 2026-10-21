import {
  compararValores,
  deCentavos,
  ehPositivo,
  multiplicar,
  normalizarValor,
  paraCentavos,
  somar,
  subtrair,
} from './dinheiro';

describe('dinheiro', () => {
  describe('paraCentavos', () => {
    it.each([
      ['123.45', 12345],
      ['123.4', 12340],
      ['123', 12300],
      ['0.01', 1],
      ['0.1', 10],
      ['0', 0],
      ['-5.50', -550],
      [' 7.00 ', 700],
      ['1234567890.99', 123456789099],
    ])('converte a string %p em %p centavos', (valor, esperado) => {
      expect(paraCentavos(valor)).toBe(esperado);
    });

    it('trata null, undefined e string vazia como zero', () => {
      expect(paraCentavos(null)).toBe(0);
      expect(paraCentavos(undefined)).toBe(0);
      expect(paraCentavos('')).toBe(0);
    });

    it('arredonda número para o centavo mais próximo', () => {
      expect(paraCentavos(0.1 + 0.2)).toBe(30);
      expect(paraCentavos(19.99)).toBe(1999);
    });

    it('não aceita zero negativo', () => {
      expect(paraCentavos('-0.00')).toBe(0);
    });

    it.each(['abc', '1.234', '1,50', '1.', '.5', 'NaN'])(
      'recusa o formato inválido %p',
      (valor) => {
        expect(() => paraCentavos(valor)).toThrow('Valor monetário inválido');
      },
    );

    it('recusa número não finito', () => {
      expect(() => paraCentavos(Number.POSITIVE_INFINITY)).toThrow();
    });
  });

  describe('deCentavos', () => {
    it.each([
      [12345, '123.45'],
      [5, '0.05'],
      [0, '0.00'],
      [100, '1.00'],
      [-550, '-5.50'],
    ])('formata %p como %p', (centavos, esperado) => {
      expect(deCentavos(centavos)).toBe(esperado);
    });

    it('recusa centavos fracionários', () => {
      expect(() => deCentavos(1.5)).toThrow();
    });
  });

  it('normaliza o valor para duas casas', () => {
    expect(normalizarValor('10.5')).toBe('10.50');
    expect(normalizarValor(null)).toBe('0.00');
  });

  it('soma sem erro de ponto flutuante', () => {
    expect(somar('0.10', '0.20')).toBe('0.30');
    expect(somar('100.00', 50, null, '0.05')).toBe('150.05');
    expect(somar()).toBe('0.00');
  });

  it('subtrai em sequência', () => {
    expect(subtrair('300.00', '50.00', '0.01')).toBe('249.99');
    expect(subtrair('10.00', '20.00')).toBe('-10.00');
  });

  it('multiplica por quantidade inteira', () => {
    expect(multiplicar('33.33', 3)).toBe('99.99');
    expect(() => multiplicar('1.00', 1.5)).toThrow();
  });

  it('compara valores', () => {
    expect(compararValores('10.00', '10')).toBe(0);
    expect(compararValores('10.01', '10.00')).toBe(1);
    expect(compararValores('9.99', '10.00')).toBe(-1);
  });

  it('diz se o valor é positivo', () => {
    expect(ehPositivo('0.01')).toBe(true);
    expect(ehPositivo('0.00')).toBe(false);
    expect(ehPositivo('-1.00')).toBe(false);
  });
});
