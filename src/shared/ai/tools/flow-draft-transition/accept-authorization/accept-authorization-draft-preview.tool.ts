import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { FlowDraftTransitionDeps } from '../_types';

export function buildAcceptAuthorizationDraftPreviewTool(
  deps: FlowDraftTransitionDeps,
): AiTool {
  const { draftService } = deps;
  return {
    name: 'accept_authorization_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'accept_authorization_draft_preview',
        description: 'Gera o preview do aceite da autorização.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'accept_authorization',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de aceite ativo.',
        });
      }
      if (!v.isReady) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam: ${v.missing.join(', ')}.`,
          nextRequiredFields: v.missing,
        });
      }
      const { text } = await draftService.getPreview(
        context.conversationId,
        'accept_authorization',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };
}
