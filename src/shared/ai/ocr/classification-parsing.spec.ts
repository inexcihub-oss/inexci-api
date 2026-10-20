import {
  coalesceStringFields,
  parseConfidence,
  parseKind,
  parseOpmeItems,
  parseStringItems,
  parseTussItems,
} from './classification-parsing';

describe('classification-parsing (resposta do LLM é entrada não confiável)', () => {
  it('ignora tipos errados sem lançar', () => {
    expect(parseKind(42, ['medical_report'])).toBe('unknown');
    expect(parseConfidence('abc')).toBe(0);
    expect(parseConfidence(7)).toBe(1);
    expect(parseTussItems('não é array', { withQty: true })).toEqual([]);
    expect(parseStringItems([' a ', 1, null, ''])).toEqual(['a']);
    expect(coalesceStringFields(null, ['name'])).toBeUndefined();
  });

  it('só mantém chaves pedidas com string não vazia', () => {
    expect(
      coalesceStringFields({ name: ' Ana ', cpf: 123, extra: 'x' }, [
        'name',
        'cpf',
      ]),
    ).toEqual({ name: 'Ana' });
  });

  it('normaliza OPME: quantidade mínima 1 e descarta item sem descrição', () => {
    expect(
      parseOpmeItems([
        { description: 'Placa', qty: '2.7', supplier: ' F1 ' },
        { description: '', qty: 3 },
        { description: 'Parafuso', qty: 'x' },
      ]),
    ).toEqual([
      { description: 'Placa', qty: 2, supplier: 'F1' },
      { description: 'Parafuso', qty: 1 },
    ]);
  });
});
