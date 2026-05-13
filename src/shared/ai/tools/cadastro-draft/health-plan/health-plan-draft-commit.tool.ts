import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { translateServiceError } from '../../helpers/service-error-translator';
import { CadastroDraftDeps } from '../_types';

export function buildHealthPlanDraftCommitTool(
  deps: CadastroDraftDeps,
): AiTool {
  const { draftService, healthPlansService } = deps;
  return {
    name: 'health_plan_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'health_plan_draft_commit',
        description:
          'Cria o convênio após confirmação (`confirm=true`). Se aberto como sub-draft de SC, popula `healthPlanId` no pai.',
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
            'Para criar o convênio, chame esta tool com `confirm=true` após confirmação do usuário.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'create_health_plan',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam campos obrigatórios: ${v.missing.join(', ')}.`
            : 'Não há rascunho de convênio ativo.',
          nextRequiredFields: v.missing,
        });
      }

      try {
        const created = await healthPlansService.create(
          { name: v.draft.fields.name!, phone: '', email: '' },
          context.userId,
        );
        await draftService.finalizeCommit(context.conversationId, {
          id: created.id,
          label: created.name,
        });
        return buildToolResult({
          status: 'ok',
          data: { id: created.id, name: created.name },
          message: `Convênio "${created.name}" cadastrado com sucesso.`,
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
