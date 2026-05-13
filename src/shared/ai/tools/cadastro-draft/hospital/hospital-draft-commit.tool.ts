import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { translateServiceError } from '../../helpers/service-error-translator';
import { CadastroDraftDeps } from '../_types';

export function buildHospitalDraftCommitTool(deps: CadastroDraftDeps): AiTool {
  const { draftService, hospitalsService } = deps;
  return {
    name: 'hospital_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'hospital_draft_commit',
        description:
          'Cria o hospital após confirmação (`confirm=true`). Se aberto como sub-draft de SC, popula `hospitalId` no pai.',
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
            'Para criar o hospital, chame esta tool com `confirm=true` após confirmação do usuário.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'create_hospital',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam campos obrigatórios: ${v.missing.join(', ')}.`
            : 'Não há rascunho de hospital ativo.',
          nextRequiredFields: v.missing,
        });
      }

      try {
        const created = await hospitalsService.create(
          { name: v.draft.fields.name! },
          context.userId,
        );
        await draftService.finalizeCommit(context.conversationId, {
          id: created.id,
          label: created.name,
        });
        return buildToolResult({
          status: 'ok',
          data: { id: created.id, name: created.name },
          message: `Hospital "${created.name}" cadastrado com sucesso.`,
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
