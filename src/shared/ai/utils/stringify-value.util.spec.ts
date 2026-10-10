import { stringifyValue } from './stringify-value.util';

describe('stringifyValue', () => {
  it('mantém string como está', () => {
    expect(stringifyValue('abc')).toBe('abc');
  });

  it('converte escalares com String', () => {
    expect(stringifyValue(42)).toBe('42');
    expect(stringifyValue(true)).toBe('true');
    expect(stringifyValue(10n)).toBe('10');
  });

  it('serializa objetos em JSON em vez de [object Object]', () => {
    expect(stringifyValue({ id: 'x' })).toBe('{"id":"x"}');
    expect(stringifyValue(['a', 'b'])).toBe('["a","b"]');
  });

  it('devolve string vazia quando o JSON não representa o valor', () => {
    expect(stringifyValue(undefined)).toBe('');
    expect(stringifyValue(() => 1)).toBe('');
  });
});
