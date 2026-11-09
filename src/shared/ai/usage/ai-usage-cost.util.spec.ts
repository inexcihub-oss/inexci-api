import { estimateCostCents } from './ai-usage-cost.util';

describe('estimateCostCents', () => {
  it('soma o custo de todos os itens com preço conhecido', () => {
    expect(
      estimateCostCents([
        { model: 'gpt-4o', promptTokens: 1000, completionTokens: 1000 },
        { model: 'gpt-4o-mini', promptTokens: 2000, completionTokens: 0 },
      ]),
    ).toBe(Math.round(0.25 + 1.0 + 0.03));
  });

  it('devolve null quando nenhum modelo tem preço', () => {
    expect(
      estimateCostCents([
        { model: 'modelo-x', promptTokens: 10, completionTokens: 10 },
        { promptTokens: 10, completionTokens: 10 },
      ]),
    ).toBeNull();
  });

  it('devolve null para lista vazia', () => {
    expect(estimateCostCents([])).toBeNull();
  });

  it('ignora itens sem preço e conta os demais', () => {
    expect(
      estimateCostCents([
        { model: 'modelo-x', promptTokens: 5000, completionTokens: 5000 },
        { model: 'gpt-4o', promptTokens: 4000, completionTokens: 0 },
      ]),
    ).toBe(1);
  });
});
