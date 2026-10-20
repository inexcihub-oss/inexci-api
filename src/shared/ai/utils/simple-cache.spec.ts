import { SimpleCache } from './simple-cache';

describe('SimpleCache', () => {
  afterEach(() => jest.useRealTimers());

  it('devolve o valor dentro do TTL e undefined depois', () => {
    jest.useFakeTimers();
    const cache = new SimpleCache<number>();
    cache.set('a', 1, 1000);
    expect(cache.get('a')).toBe(1);
    jest.advanceTimersByTime(1001);
    expect(cache.get('a')).toBeUndefined();
  });

  it('respeita o teto de entradas descartando a mais antiga', () => {
    const cache = new SimpleCache<number>(2);
    cache.set('a', 1, 60_000);
    cache.set('b', 2, 60_000);
    cache.set('c', 3, 60_000);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('prefere descartar expiradas antes das válidas', () => {
    jest.useFakeTimers();
    const cache = new SimpleCache<number>(2);
    cache.set('valida', 1, 60_000);
    cache.set('expira', 2, 10);
    jest.advanceTimersByTime(20);
    cache.set('nova', 3, 60_000);
    expect(cache.get('valida')).toBe(1);
    expect(cache.get('nova')).toBe(3);
  });

  it('regravar a mesma chave não conta como entrada nova', () => {
    const cache = new SimpleCache<number>(2);
    cache.set('a', 1, 60_000);
    cache.set('b', 2, 60_000);
    cache.set('a', 10, 60_000);
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('a')).toBe(10);
  });
});
