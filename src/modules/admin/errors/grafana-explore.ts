export interface ExploreLinkConfig {
  exploreUrl?: string | null;
  datasourceUid?: string | null;
  service: string;
}

const WINDOW_MS = 15 * 60 * 1000;

export function buildExploreUrl(
  config: ExploreLinkConfig,
  ids: { requestId?: string | null; traceId?: string | null },
  at: Date,
): string | null {
  const base = config.exploreUrl?.trim();
  if (!base) return null;
  const id = ids.requestId ?? ids.traceId;
  if (!id) return null;
  const field = ids.requestId ? 'requestId' : 'traceId';
  const expr = `{service="${config.service}"} | json | ${field}="${id}"`;
  const datasource = config.datasourceUid
    ? { type: 'loki', uid: config.datasourceUid }
    : undefined;
  const panes = {
    a: {
      ...(datasource ? { datasource: datasource.uid } : {}),
      queries: [{ refId: 'A', expr, ...(datasource ? { datasource } : {}) }],
      range: {
        from: String(at.getTime() - WINDOW_MS),
        to: String(at.getTime() + WINDOW_MS),
      },
    },
  };
  const params = new URLSearchParams({
    schemaVersion: '1',
    panes: JSON.stringify(panes),
  });
  return `${base.replace(/\?.*$/, '')}?${params.toString()}`;
}
