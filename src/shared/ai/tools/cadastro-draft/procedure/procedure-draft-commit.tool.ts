import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { translateServiceError } from '../../helpers/service-error-translator';
import { normalizeNameForCompare } from '../../catalog.helpers';
import { CadastroDraftDeps } from '../_types';

export function buildProcedureDraftCommitTool(deps: CadastroDraftDeps): AiTool {
  const { draftService, procedureRepo, proceduresService } = deps;
  return {
    name: 'procedure_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'procedure_draft_commit',
        description:
          'Cria o procedimento no catálogo global após confirmação (`confirm=true`). Se aberto como sub-draft de SC, popula `procedureId` no pai.',
        parameters: {
          type: 'object',
          properties: { confirm: { type: 'boolean' } },
          required: ['confirm'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      if (!context.userId) {
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      }
      if (!(args as any).confirm) {
        return buildToolResult({
          status: 'pending_confirmation',
          message:
            'Para criar o procedimento, chame esta tool com `confirm=true` após confirmação do usuário.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'create_procedure',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam campos obrigatórios: ${v.missing.join(', ')}.`
            : 'Não há rascunho de procedimento ativo.',
          nextRequiredFields: v.missing,
        });
      }

      const rawName = v.draft.fields.name!;
      const target = normalizeNameForCompare(rawName);

      let existing = await procedureRepo.findOne({ name: rawName } as any);
      if (!existing) {
        const candidates = await procedureRepo.findMany({} as any, 0, 200);
        existing =
          candidates.find(
            (item) => normalizeNameForCompare(item.name) === target,
          ) ?? null;
      }
      if (existing) {
        await draftService.finalizeCommit(context.conversationId, {
          id: existing.id,
          label: existing.name,
        });
        return buildToolResult({
          status: 'ok',
          data: { id: existing.id, name: existing.name, reused: true },
          message: `Procedimento "${existing.name}" já existia — usando o cadastro existente.`,
        });
      }

      try {
        const created = await proceduresService.create({ name: rawName });
        await draftService.finalizeCommit(context.conversationId, {
          id: created.id,
          label: created.name,
        });
        return buildToolResult({
          status: 'ok',
          data: { id: created.id, name: created.name },
          message: `Procedimento "${created.name}" cadastrado com sucesso.`,
        });
      } catch (err) {
        return buildToolResult({
          status: 'error',
          message: translateServiceError(err),
        });
      }
    },
  };
}
