import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { FlowDraftTransitionDeps } from '../_types';

export function buildStartAnalysisDraftPreviewTool(
  deps: FlowDraftTransitionDeps,
): AiTool {
  const { draftService } = deps;
  return {
    name: 'start_analysis_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'start_analysis_draft_preview',
        description: 'Gera o preview do rascunho de início de análise.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'start_analysis',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de análise ativo.',
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
        'start_analysis',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };
}
