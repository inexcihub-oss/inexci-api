import {
  formatarReais,
  inteiroPorExtenso,
  valorPorExtenso,
} from './valor-por-extenso';

describe('valorPorExtenso', () => {
  it.each([
    ['0.00', 'zero reais'],
    ['0', 'zero reais'],
    ['0.01', 'um centavo'],
    ['0.50', 'cinquenta centavos'],
    ['1.00', 'um real'],
    ['1.01', 'um real e um centavo'],
    ['2.00', 'dois reais'],
    ['10.00', 'dez reais'],
    ['15.00', 'quinze reais'],
    ['19.90', 'dezenove reais e noventa centavos'],
    ['21.00', 'vinte e um reais'],
    ['100.00', 'cem reais'],
    ['101.00', 'cento e um reais'],
    ['110.00', 'cento e dez reais'],
    ['150.00', 'cento e cinquenta reais'],
    ['200.00', 'duzentos reais'],
    ['250.75', 'duzentos e cinquenta reais e setenta e cinco centavos'],
    ['999.99', 'novecentos e noventa e nove reais e noventa e nove centavos'],
    ['1000.00', 'mil reais'],
    ['1001.00', 'mil e um reais'],
    ['1100.00', 'mil e cem reais'],
    ['1200.00', 'mil e duzentos reais'],
    [
      '1234.56',
      'mil duzentos e trinta e quatro reais e cinquenta e seis centavos',
    ],
    ['2000.00', 'dois mil reais'],
    ['21000.00', 'vinte e um mil reais'],
    ['100000.00', 'cem mil reais'],
    ['101000.00', 'cento e um mil reais'],
    ['1000000.00', 'um milhão de reais'],
    ['1000000.50', 'um milhão de reais e cinquenta centavos'],
    ['2000000.00', 'dois milhões de reais'],
    ['1200000.00', 'um milhão e duzentos mil reais'],
    ['1000001.00', 'um milhão e um reais'],
    ['1001234.00', 'um milhão, mil duzentos e trinta e quatro reais'],
    ['1000000000.00', 'um bilhão de reais'],
    [
      '9999999999.99',
      'nove bilhões, novecentos e noventa e nove milhões, novecentos e noventa e nove mil novecentos e noventa e nove reais e noventa e nove centavos',
    ],
  ])('%p → %p', (valor, esperado) => {
    expect(valorPorExtenso(valor)).toBe(esperado);
  });

  it('recusa valor negativo', () => {
    expect(() => valorPorExtenso('-1.00')).toThrow();
  });

  it('recusa formato inválido', () => {
    expect(() => valorPorExtenso('1,50')).toThrow('Valor monetário inválido');
  });

  it('extenso de inteiro recusa fração', () => {
    expect(() => inteiroPorExtenso(1.5)).toThrow();
    expect(inteiroPorExtenso(0)).toBe('zero');
  });
});

describe('formatarReais', () => {
  it.each([
    ['0', 'R$ 0,00'],
    ['5.5', 'R$ 5,50'],
    ['1234.56', 'R$ 1.234,56'],
    ['1000000.00', 'R$ 1.000.000,00'],
    ['-10.00', '-R$ 10,00'],
  ])('%p → %p', (valor, esperado) => {
    expect(formatarReais(valor)).toBe(esperado);
  });
});
