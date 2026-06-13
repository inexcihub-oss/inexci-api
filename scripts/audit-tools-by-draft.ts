#!/usr/bin/env ts-node
/* eslint-disable no-console */

/**
 * Audita o tamanho da lista de tools enviada à OpenAI para cada `draftType`,
 * usando o `ToolRegistryService` real (com a fábrica `aiToolsFactory`).
 *
 * Saída exemplo (markdown):
 *
 *   | draftType            | tools | json_chars |
 *   | -------------------- | ----: | ---------: |
 *   | none                 |    27 |     12 345 |
 *   | create_sc            |    29 |     14 222 |
 *   | ...                  |       |            |
 *
 * Uso:
 *   yarn ts-node -r tsconfig-paths/register scripts/audit-tools-by-draft.ts
 *   yarn ts-node -r tsconfig-paths/register scripts/audit-tools-by-draft.ts --json
 *
 * Fundamento: Fase 0 do Blueprint v3 (instrumentação) + validação contínua
 * para a Fase 3 (`ToolSubsetSelector`) — saber a baseline de tools/turno.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiToolsModule } from '../src/shared/ai/tools/ai-tools.module';
import { ToolRegistryService } from '../src/shared/ai/services/tool-registry.service';
import { OperationDraftType } from '../src/shared/ai/drafts/operation-draft.types';

const ALL_DRAFT_TYPES: Array<OperationDraftType | null> = [
  null,
  'create_sc',
  'create_patient',
  'create_hospital',
  'create_health_plan',
  'create_procedure',
  'invoice',
  'contestation',
  'scheduling',
  'update_sc',
  'send_sc',
  'start_analysis',
  'accept_authorization',
  'mark_performed',
];

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AiToolsModule],
})
class AuditModule {}

async function main(): Promise<void> {
  const wantJson = process.argv.includes('--json');

  const app = await NestFactory.createApplicationContext(AuditModule, {
    logger: false,
  });
  const registry = app.get(ToolRegistryService);

  const rows = ALL_DRAFT_TYPES.map((draftType) => {
    const definitions = registry.getToolDefinitionsForDraft(draftType);
    const json = JSON.stringify(definitions);
    return {
      draftType: draftType ?? 'none',
      toolCount: definitions.length,
      jsonChars: json.length,
    };
  });

  await app.close();

  if (wantJson) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
    return;
  }

  const widths = {
    draft: Math.max('draftType'.length, ...rows.map((r) => r.draftType.length)),
    count: 5,
    chars: 10,
  };
  const pad = (s: string, w: number, right = false): string =>
    right ? s.padStart(w) : s.padEnd(w);

  console.log(
    `| ${pad('draftType', widths.draft)} | ${pad('tools', widths.count, true)} | ${pad('json_chars', widths.chars, true)} |`,
  );
  console.log(
    `| ${'-'.repeat(widths.draft)} | ${'-'.repeat(widths.count)}: | ${'-'.repeat(widths.chars)}: |`,
  );
  for (const r of rows) {
    console.log(
      `| ${pad(r.draftType, widths.draft)} | ${pad(String(r.toolCount), widths.count, true)} | ${pad(String(r.jsonChars), widths.chars, true)} |`,
    );
  }

  const totalAvg =
    rows.reduce((acc, r) => acc + r.toolCount, 0) / rows.length;
  const charsAvg = rows.reduce((acc, r) => acc + r.jsonChars, 0) / rows.length;
  console.log(`\nMédia tools/draft: ${totalAvg.toFixed(1)}`);
  console.log(`Média json chars/draft: ${charsAvg.toFixed(0)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
