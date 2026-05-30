import { RagHybridSearchService } from './rag-hybrid-search.service';

describe('RagHybridSearchService.reciprocalRankFusion', () => {
  // Construímos a instância sem deps — o método RRF é puro.
  const svc = new RagHybridSearchService(
    {} as any,
    {} as any,
    {} as any,
  );

  it('combina rankings de cosine e bm25 via RRF', () => {
    const cosine = [
      { id: 'a', rank: 1, source: 'cosine' as const, score: 0.9 },
      { id: 'b', rank: 2, source: 'cosine' as const, score: 0.7 },
    ];
    const bm25 = [
      { id: 'b', rank: 1, source: 'bm25' as const, score: 5 },
      { id: 'c', rank: 2, source: 'bm25' as const, score: 3 },
    ];
    const fused = svc.reciprocalRankFusion(cosine, bm25);
    const ids = fused.map((f) => f.id);
    expect(ids[0]).toBe('b'); // está em ambos → maior score
    expect(ids).toContain('a');
    expect(ids).toContain('c');
  });

  it('lista vazia → resultado vazio', () => {
    expect(svc.reciprocalRankFusion([], [])).toEqual([]);
  });

  it('só cosine sem bm25 ainda funciona', () => {
    const fused = svc.reciprocalRankFusion(
      [
        { id: 'a', rank: 1, source: 'cosine', score: 1 },
        { id: 'b', rank: 2, source: 'cosine', score: 0.5 },
      ],
      [],
    );
    expect(fused.map((f) => f.id)).toEqual(['a', 'b']);
  });
});
