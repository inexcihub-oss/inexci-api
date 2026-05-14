#!/usr/bin/env ts-node
/* eslint-disable no-console */
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Auditoria estática da camada `/shared/ai/` do backend.
 *
 * Reporta:
 * - Top 20 arquivos por número de linhas em `src/shared/ai/`.
 * - Total de `as any` por arquivo (regex `\bas\s+any\b`).
 * - Total de `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error` por arquivo.
 * - Quantidade de tools registradas (parse de `tool-registry.service.ts`).
 *
 * Uso:
 *   yarn audit:ai-code                               (relatório padrão)
 *   yarn audit:ai-code --json                        (somente JSON)
 *   yarn audit:ai-code --markdown                    (somente markdown)
 *   yarn audit:ai-code --baseline <caminho.json>     (compara contra baseline)
 *   yarn audit:ai-code --output <caminho.json>       (grava JSON em disco)
 *   yarn audit:ai-code --check                       (modo CI: falha em violações)
 *
 * Saída padrão: relatório markdown legível. Em modo `--json` ou `--check`,
 * imprime apenas o objeto JSON. O modo `--check` aplica os guardrails:
 *   1. Nenhum arquivo > MAX_FILE_LINES (default 800) em `src/shared/ai/`.
 *   2. Crescimento de `as any` total <= MAX_AS_ANY_GROWTH_PCT (default 5 %)
 *      vs `--baseline`.
 *
 * Plano de origem: `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`, Fase 0.
 */

const AI_ROOT_RELATIVE = 'src/shared/ai';
const TOOL_REGISTRY_RELATIVE = 'src/shared/ai/services/tool-registry.service.ts';

const MAX_FILE_LINES_DEFAULT = 800;
const MAX_AS_ANY_GROWTH_PCT_DEFAULT = 5;

const AS_ANY_REGEX = /\bas\s+any\b/g;
const TS_IGNORE_REGEX = /@ts-ignore\b/g;
const TS_NOCHECK_REGEX = /@ts-nocheck\b/g;
const TS_EXPECT_ERROR_REGEX = /@ts-expect-error\b/g;

interface FileMetrics {
  /** Caminho relativo a partir de `inexci-api/` (sem leading `./`). */
  path: string;
  lines: number;
  asAnyCount: number;
  tsIgnoreCount: number;
  tsNocheckCount: number;
  tsExpectErrorCount: number;
}

interface ToolRegistryMetrics {
  /** Quantidade de imports `buildXxxTools` em `tool-registry.service.ts`. */
  toolBuildersImported: number;
  /** Quantidade de spreads `...buildXxxTools(...)` no array central. */
  toolBuildersInvoked: number;
}

interface AuditReport {
  generatedAt: string;
  rootDirectory: string;
  totals: {
    files: number;
    lines: number;
    asAny: number;
    tsIgnore: number;
    tsNocheck: number;
    tsExpectError: number;
  };
  toolRegistry: ToolRegistryMetrics;
  topFilesByLines: FileMetrics[];
  topFilesByAsAny: FileMetrics[];
  filesWithTsDirectives: FileMetrics[];
}

interface ParsedArgs {
  format: 'markdown' | 'json' | 'both';
  baselinePath?: string;
  outputPath?: string;
  check: boolean;
  maxFileLines: number;
  maxAsAnyGrowthPct: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    format: 'markdown',
    check: false,
    maxFileLines: MAX_FILE_LINES_DEFAULT,
    maxAsAnyGrowthPct: MAX_AS_ANY_GROWTH_PCT_DEFAULT,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--json':
        args.format = 'json';
        break;
      case '--markdown':
        args.format = 'markdown';
        break;
      case '--both':
        args.format = 'both';
        break;
      case '--baseline':
        args.baselinePath = argv[++i];
        break;
      case '--output':
        args.outputPath = argv[++i];
        break;
      case '--check':
        args.check = true;
        if (args.format === 'markdown') args.format = 'json';
        break;
      case '--max-file-lines':
        args.maxFileLines = Number(argv[++i]) || MAX_FILE_LINES_DEFAULT;
        break;
      case '--max-as-any-growth-pct':
        args.maxAsAnyGrowthPct =
          Number(argv[++i]) || MAX_AS_ANY_GROWTH_PCT_DEFAULT;
        break;
      default:
        // ignore unknown flags to keep the script friendly
        break;
    }
  }
  return args;
}

async function walkTypescriptFiles(root: string): Promise<string[]> {
  const collected: string[] = [];
  async function recurse(dir: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        await recurse(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        collected.push(fullPath);
      }
    }
  }
  await recurse(root);
  return collected;
}

function countMatches(content: string, regex: RegExp): number {
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}

async function readFileMetrics(
  fullPath: string,
  baseDir: string,
): Promise<FileMetrics> {
  const content = await fs.readFile(fullPath, 'utf8');
  const lines = content.length === 0 ? 0 : content.split('\n').length;
  return {
    path: path.relative(baseDir, fullPath).replace(/\\/g, '/'),
    lines,
    asAnyCount: countMatches(content, AS_ANY_REGEX),
    tsIgnoreCount: countMatches(content, TS_IGNORE_REGEX),
    tsNocheckCount: countMatches(content, TS_NOCHECK_REGEX),
    tsExpectErrorCount: countMatches(content, TS_EXPECT_ERROR_REGEX),
  };
}

async function readToolRegistryMetrics(
  registryPath: string,
): Promise<ToolRegistryMetrics> {
  let content: string;
  try {
    content = await fs.readFile(registryPath, 'utf8');
  } catch {
    return { toolBuildersImported: 0, toolBuildersInvoked: 0 };
  }
  const importRegex =
    /^\s*import\s*\{[^}]*\bbuild[A-Z][A-Za-z0-9_]*Tools\b[^}]*\}\s*from\s*['"][^'"]+['"];?/gm;
  const invocationRegex = /\.\.\.build[A-Z][A-Za-z0-9_]*Tools\s*\(/g;

  // Count distinct builder names imported (an import line can declare multiple).
  const importedNames = new Set<string>();
  for (const match of content.matchAll(importRegex)) {
    const inner = match[0];
    for (const name of inner.match(/\bbuild[A-Z][A-Za-z0-9_]*Tools\b/g) ?? []) {
      importedNames.add(name);
    }
  }
  const invocations = content.match(invocationRegex)?.length ?? 0;

  return {
    toolBuildersImported: importedNames.size,
    toolBuildersInvoked: invocations,
  };
}

async function buildReport(apiRoot: string): Promise<AuditReport> {
  const aiRoot = path.join(apiRoot, AI_ROOT_RELATIVE);
  const files = await walkTypescriptFiles(aiRoot);
  const metrics = await Promise.all(
    files.map((file) => readFileMetrics(file, apiRoot)),
  );

  const totals = metrics.reduce(
    (acc, m) => {
      acc.files += 1;
      acc.lines += m.lines;
      acc.asAny += m.asAnyCount;
      acc.tsIgnore += m.tsIgnoreCount;
      acc.tsNocheck += m.tsNocheckCount;
      acc.tsExpectError += m.tsExpectErrorCount;
      return acc;
    },
    {
      files: 0,
      lines: 0,
      asAny: 0,
      tsIgnore: 0,
      tsNocheck: 0,
      tsExpectError: 0,
    },
  );

  const sortedByLines = [...metrics].sort((a, b) => b.lines - a.lines);
  const sortedByAsAny = [...metrics]
    .filter((m) => m.asAnyCount > 0)
    .sort((a, b) => b.asAnyCount - a.asAnyCount);
  const filesWithTsDirectives = metrics
    .filter(
      (m) =>
        m.tsIgnoreCount + m.tsNocheckCount + m.tsExpectErrorCount > 0,
    )
    .sort(
      (a, b) =>
        b.tsIgnoreCount +
        b.tsNocheckCount +
        b.tsExpectErrorCount -
        (a.tsIgnoreCount + a.tsNocheckCount + a.tsExpectErrorCount),
    );

  const toolRegistry = await readToolRegistryMetrics(
    path.join(apiRoot, TOOL_REGISTRY_RELATIVE),
  );

  return {
    generatedAt: new Date().toISOString(),
    rootDirectory: AI_ROOT_RELATIVE,
    totals,
    toolRegistry,
    topFilesByLines: sortedByLines.slice(0, 20),
    topFilesByAsAny: sortedByAsAny.slice(0, 20),
    filesWithTsDirectives,
  };
}

function renderMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`# Audit AI Code — ${report.generatedAt}`);
  lines.push('');
  lines.push(`Diretório auditado: \`${report.rootDirectory}\``);
  lines.push('');
  lines.push('## Totais');
  lines.push('');
  lines.push('| Métrica | Valor |');
  lines.push('| --- | ---: |');
  lines.push(`| Arquivos \`.ts\` | ${report.totals.files} |`);
  lines.push(`| Linhas totais | ${report.totals.lines} |`);
  lines.push(`| \`as any\` | ${report.totals.asAny} |`);
  lines.push(`| \`@ts-ignore\` | ${report.totals.tsIgnore} |`);
  lines.push(`| \`@ts-nocheck\` | ${report.totals.tsNocheck} |`);
  lines.push(`| \`@ts-expect-error\` | ${report.totals.tsExpectError} |`);
  lines.push(
    `| Tool builders importados | ${report.toolRegistry.toolBuildersImported} |`,
  );
  lines.push(
    `| Tool builders invocados | ${report.toolRegistry.toolBuildersInvoked} |`,
  );
  lines.push('');
  lines.push('## Top 20 arquivos por linhas');
  lines.push('');
  lines.push('| # | Arquivo | Linhas | as any |');
  lines.push('| ---: | --- | ---: | ---: |');
  report.topFilesByLines.forEach((m, idx) => {
    lines.push(`| ${idx + 1} | \`${m.path}\` | ${m.lines} | ${m.asAnyCount} |`);
  });
  lines.push('');
  if (report.topFilesByAsAny.length > 0) {
    lines.push('## Top arquivos por `as any`');
    lines.push('');
    lines.push('| # | Arquivo | as any | Linhas |');
    lines.push('| ---: | --- | ---: | ---: |');
    report.topFilesByAsAny.forEach((m, idx) => {
      lines.push(
        `| ${idx + 1} | \`${m.path}\` | ${m.asAnyCount} | ${m.lines} |`,
      );
    });
    lines.push('');
  }
  if (report.filesWithTsDirectives.length > 0) {
    lines.push('## Arquivos com diretivas `@ts-*`');
    lines.push('');
    lines.push('| Arquivo | ignore | nocheck | expect-error |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const m of report.filesWithTsDirectives) {
      lines.push(
        `| \`${m.path}\` | ${m.tsIgnoreCount} | ${m.tsNocheckCount} | ${m.tsExpectErrorCount} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function loadBaseline(baselinePath: string): Promise<AuditReport | null> {
  try {
    const content = await fs.readFile(baselinePath, 'utf8');
    return JSON.parse(content) as AuditReport;
  } catch (error) {
    console.error(
      `[audit-ai-code] Falha ao ler baseline em '${baselinePath}': ${
        (error as Error).message
      }`,
    );
    return null;
  }
}

interface OversizedFileViolation {
  path: string;
  currentLines: number;
  baselineLines: number | null;
  reason: 'new-file' | 'grew-past-baseline';
}

interface CheckViolations {
  oversizedFiles: OversizedFileViolation[];
  asAnyGrowth: {
    baseline: number;
    current: number;
    pct: number;
    limitPct: number;
  } | null;
}

/**
 * Avalia os guardrails da Fase 0:
 *
 * 1. Tamanho de arquivo: falha apenas para arquivos > `maxFileLines` que sejam
 *    **novos** (não existiam no baseline) ou que **cresceram** desde o baseline.
 *    Os arquivos legados acima do limite (god objects e tools gigantes) são
 *    pré-existentes e tratados nas Fases 1 e 2 — não devem quebrar CI agora.
 *
 * 2. `as any`: falha quando o total cresce mais que `maxAsAnyGrowthPct` % vs
 *    baseline. A redução faz parte da Fase 3, mas crescimento silencioso é
 *    sempre regressão.
 *
 * Sem baseline, o check de tamanho ainda dispara (assume todos os arquivos
 * grandes como "novos"), garantindo que `--check` sem baseline não passe
 * silenciosamente em projetos virgens.
 */
function evaluateChecks(
  report: AuditReport,
  baseline: AuditReport | null,
  args: ParsedArgs,
): CheckViolations {
  const baselineLinesByPath = new Map<string, number>();
  if (baseline) {
    for (const m of baseline.topFilesByLines) {
      baselineLinesByPath.set(m.path, m.lines);
    }
  }

  const oversizedFiles: OversizedFileViolation[] = [];
  for (const m of report.topFilesByLines) {
    if (m.lines <= args.maxFileLines) continue;
    const baselineLines = baseline
      ? baselineLinesByPath.get(m.path) ?? null
      : null;
    if (baselineLines === null) {
      oversizedFiles.push({
        path: m.path,
        currentLines: m.lines,
        baselineLines: null,
        reason: 'new-file',
      });
    } else if (m.lines > baselineLines) {
      oversizedFiles.push({
        path: m.path,
        currentLines: m.lines,
        baselineLines,
        reason: 'grew-past-baseline',
      });
    }
  }

  let asAnyGrowth: CheckViolations['asAnyGrowth'] = null;
  if (baseline) {
    const baselineCount = baseline.totals.asAny || 0;
    const currentCount = report.totals.asAny;
    if (baselineCount === 0 && currentCount > 0) {
      asAnyGrowth = {
        baseline: 0,
        current: currentCount,
        pct: Number.POSITIVE_INFINITY,
        limitPct: args.maxAsAnyGrowthPct,
      };
    } else if (baselineCount > 0) {
      const pct = ((currentCount - baselineCount) / baselineCount) * 100;
      if (pct > args.maxAsAnyGrowthPct) {
        asAnyGrowth = {
          baseline: baselineCount,
          current: currentCount,
          pct,
          limitPct: args.maxAsAnyGrowthPct,
        };
      }
    }
  }
  return { oversizedFiles, asAnyGrowth };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apiRoot = path.resolve(__dirname, '..');
  const startedAt = Date.now();

  const report = await buildReport(apiRoot);
  const baseline = args.baselinePath
    ? await loadBaseline(path.resolve(args.baselinePath))
    : null;
  const violations = evaluateChecks(report, baseline, args);

  if (args.outputPath) {
    const outPath = path.resolve(args.outputPath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }

  if (args.format === 'json') {
    console.log(JSON.stringify({ report, violations }, null, 2));
  } else if (args.format === 'both') {
    console.log(renderMarkdown(report));
    console.log('\n---\n');
    console.log('```json');
    console.log(JSON.stringify({ report, violations }, null, 2));
    console.log('```');
  } else {
    console.log(renderMarkdown(report));
  }

  const durationMs = Date.now() - startedAt;
  if (args.format !== 'json') {
    console.error(`\n[audit-ai-code] Concluído em ${durationMs} ms.`);
  }

  if (args.check) {
    const failures: string[] = [];
    if (violations.oversizedFiles.length > 0) {
      failures.push(
        `Arquivos > ${args.maxFileLines} linhas em ${AI_ROOT_RELATIVE}/ (novos ou que cresceram):\n` +
          violations.oversizedFiles
            .map((m) => {
              const baselineInfo =
                m.reason === 'new-file'
                  ? 'arquivo novo'
                  : `cresceu de ${m.baselineLines} para ${m.currentLines}`;
              return `  - ${m.path} (${m.currentLines} linhas; ${baselineInfo})`;
            })
            .join('\n'),
      );
    }
    if (violations.asAnyGrowth) {
      const g = violations.asAnyGrowth;
      failures.push(
        `Crescimento de \`as any\` ${g.pct.toFixed(2)} % > limite ${g.limitPct} % ` +
          `(baseline=${g.baseline}, atual=${g.current})`,
      );
    }
    if (failures.length > 0) {
      console.error('\n[audit-ai-code] FALHAS detectadas:');
      for (const f of failures) console.error(`- ${f}`);
      process.exit(1);
    }
    console.error('[audit-ai-code] OK — nenhuma violação.');
  }
}

main().catch((error) => {
  console.error('[audit-ai-code] Erro fatal:', error);
  process.exit(2);
});
