import { buildExploreUrl } from './grafana-explore';

describe('buildExploreUrl', () => {
  const at = new Date('2026-10-28T12:00:00Z');

  it('sem URL configurada ou sem id não monta link', () => {
    expect(
      buildExploreUrl({ service: 'inexci-api' }, { requestId: 'r1' }, at),
    ).toBeNull();
    expect(
      buildExploreUrl(
        { service: 'inexci-api', exploreUrl: 'https://g.net/explore' },
        {},
        at,
      ),
    ).toBeNull();
  });

  it('filtra pelo requestId numa janela de 15 min e inclui o datasource', () => {
    const url = buildExploreUrl(
      {
        service: 'inexci-api',
        exploreUrl: 'https://g.net/explore',
        datasourceUid: 'loki-uid',
      },
      { requestId: 'r1', traceId: 't1' },
      at,
    );
    const parsed = new URL(url as string);
    expect(parsed.origin + parsed.pathname).toBe('https://g.net/explore');
    const panes = JSON.parse(parsed.searchParams.get('panes') as string);
    expect(panes.a.datasource).toBe('loki-uid');
    expect(panes.a.queries[0].expr).toBe(
      '{service="inexci-api"} | json | requestId="r1"',
    );
    expect(panes.a.range).toEqual({
      from: String(at.getTime() - 15 * 60 * 1000),
      to: String(at.getTime() + 15 * 60 * 1000),
    });
  });

  it('sem requestId usa o traceId', () => {
    const url = buildExploreUrl(
      { service: 'inexci-api', exploreUrl: 'https://g.net/explore' },
      { traceId: 't1' },
      at,
    );
    const panes = JSON.parse(
      new URL(url as string).searchParams.get('panes') as string,
    );
    expect(panes.a.queries[0].expr).toContain('traceId="t1"');
  });
});
