import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { CadastroDraftDeps } from '../_types';

export function buildProcedureDraftPreviewTool(
  deps: CadastroDraftDeps,
): AiTool {
  const { draftService } = deps;
  return {
    name: 'procedure_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'procedure_draft_preview',
        description: 'Gera o preview do rascunho de procedimento.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'create_procedure',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de procedimento ativo.',
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
        'create_procedure',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };
}
