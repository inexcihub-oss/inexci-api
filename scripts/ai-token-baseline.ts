import 'dotenv/config';
import { Client } from 'pg';

/**
 * Extrai a baseline de uso de tokens da IA do WhatsApp a partir da tabela
 * `ai_token_usage_log`. Saída: médias, mediana e p95 de prompt/completion/total
 * tokens, separadas por categoria de fluxo (consulta simples, com tools, com RAG)
 * e janela temporal (7 dias / completo).
 *
 * Categoria de fluxo é heurística baseada no `breakdown[].stage`:
 *   - `tools` se algum stage tiver nome `tools` ou `tool_call`;
 *   - `rag` se algum stage incluir `rag`;
 *   - `simple` caso contrário.
 *
 * Uso:
 *   yarn baseline:tokens
 *
 * Para CI/dev: pode ser apontado contra dev/staging via DATABASE_URL.
 */

interface BucketStats {
  flow: string;
  window: string;
  count: number;
  avgPrompt: number;
  avgCompletion: number;
  avgTotal: number;
  medianTotal: number;
  p95Total: number;
}

async function fetchStats(
  client: Client,
  windowDays: number | null,
): Promise<BucketStats[]> {
  const windowSql = windowDays
    ? `AND created_at >= NOW() - INTERVAL '${windowDays} days'`
    : '';

  const rows = await client.query(`
    WITH classified AS (
      SELECT
        prompt_tokens,
        completion_tokens,
        total_tokens,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM jsonb_array_elements(breakdown) b
            WHERE b->>'stage' ILIKE '%tool%'
          ) THEN 'tools'
          WHEN EXISTS (
            SELECT 1 FROM jsonb_array_elements(breakdown) b
            WHERE b->>'stage' ILIKE '%rag%'
          ) THEN 'rag'
          ELSE 'simple'
        END AS flow
      FROM ai_token_usage_log
      WHERE 1 = 1 ${windowSql}
    )
    SELECT
      flow,
      COUNT(*)::int                                 AS count,
      ROUND(AVG(prompt_tokens))                     AS avg_prompt,
      ROUND(AVG(completion_tokens))                 AS avg_completion,
      ROUND(AVG(total_tokens))                      AS avg_total,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_tokens) AS median_total,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_tokens) AS p95_total
    FROM classified
    GROUP BY flow
    ORDER BY flow
  `);

  return rows.rows.map((r) => ({
    flow: r.flow,
    window: windowDays ? `${windowDays}d` : 'all',
    count: Number(r.count),
    avgPrompt: Number(r.avg_prompt) || 0,
    avgCompletion: Number(r.avg_completion) || 0,
    avgTotal: Number(r.avg_total) || 0,
    medianTotal: Number(r.median_total) || 0,
    p95Total: Number(r.p95_total) || 0,
  }));
}

function formatTable(rows: BucketStats[]): string {
  if (!rows.length) return '_(sem dados)_';
  const header =
    '| Janela | Fluxo | Amostras | Avg prompt | Avg completion | Avg total | Mediana total | P95 total |';
  const sep =
    '|--------|-------|---------:|-----------:|---------------:|----------:|--------------:|----------:|';
  const body = rows.map(
    (r) =>
      `| ${r.window} | ${r.flow} | ${r.count} | ${r.avgPrompt} | ${r.avgCompletion} | ${r.avgTotal} | ${Math.round(
        r.medianTotal,
      )} | ${Math.round(r.p95Total)} |`,
  );
  return [header, sep, ...body].join('\n');
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[baseline] DATABASE_URL não definido.');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    const total = await client.query(
      'SELECT COUNT(*)::int AS total FROM ai_token_usage_log',
    );
    const totalCount = Number(total.rows[0]?.total ?? 0);

    if (totalCount === 0) {
      console.log('[baseline] Nenhum registro em `ai_token_usage_log`.');
      return;
    }

    const sevenDays = await fetchStats(client, 7);
    const all = await fetchStats(client, null);

    const reducedSample = sevenDays.reduce((s, r) => s + r.count, 0) < 50;

    const md = `# Baseline de tokens — IA WhatsApp\n\n` +
      `Gerado em: ${new Date().toISOString()}\n\n` +
      `Total de registros: **${totalCount}**\n\n` +
      `${reducedSample ? '> ⚠️ Amostra reduzida (<50 registros nos últimos 7 dias). Os números podem oscilar.\n\n' : ''}` +
      `## Janela: últimos 7 dias\n\n${formatTable(sevenDays)}\n\n` +
      `## Janela: todo o histórico\n\n${formatTable(all)}\n`;

    process.stdout.write(md);
  } catch (error) {
    console.error(`[baseline] erro: ${(error as Error).message}`);
    process.exit(2);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main();
