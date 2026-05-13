import OpenAI from 'openai';
import { AiTool, ToolContext } from '../tool.interface';
import { buildToolResult } from '../tool-result';
import { ScDraftToolDeps } from './_types';
import { autoFillDoctorIfSingle } from './_helpers';

export function buildScDraftPreviewTool(deps: ScDraftToolDeps): AiTool {
  const { draftService, userRepo } = deps;
  return {
    name: 'sc_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'sc_draft_preview',
        description:
          'Gera o preview textual do rascunho de SC para o usuário confirmar. Marca o draft como `pending_confirmation`.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context: ToolContext): Promise<string> {
      await autoFillDoctorIfSingle(draftService, userRepo, context);
      const validation = await draftService.validate(
        context.conversationId,
        'create_sc',
      );
      if (!validation.draft) {
        return buildToolResult({
          status: 'blocked',
          message:
            'Não há rascunho de SC ativo. Chame `plan_actions` com intent="create_sc" primeiro.',
        });
      }
      if (!validation.isReady) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam campos obrigatórios: ${validation.missing.join(', ')}.`,
          nextRequiredFields: validation.missing,
        });
      }
      const { text, draft } = await draftService.getPreview(
        context.conversationId,
        'create_sc',
      );
      return buildToolResult({
        status: 'pending_confirmation',
        message: 'Aguardando confirmação do usuário para criar a SC.',
        displayText: text,
        data: draft ? { draft } : null,
        pendingConfirmation: {
          tool: 'sc_draft_commit',
          args: { confirm: true },
          description: 'Cria a SC com os dados do rascunho atual.',
        },
      });
    },
  };
}
