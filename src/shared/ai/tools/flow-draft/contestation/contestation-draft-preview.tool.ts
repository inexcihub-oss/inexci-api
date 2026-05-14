import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { FlowDraftDeps } from '../_types';

export function buildContestationDraftPreviewTool(deps: FlowDraftDeps): AiTool {
  const { draftService } = deps;
  return {
    name: 'contestation_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'contestation_draft_preview',
        description: 'Gera o preview da contestação.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'contestation',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de contestação ativo.',
        });
      }
      const f = v.draft.fields;
      const missing = [...v.missing];
      if (f.contestationType === 'PAYMENT') {
        if (!f.to) missing.push('to');
        if (!f.subject) missing.push('subject');
        if (!f.message) missing.push('message');
      }
      if (f.contestationType === 'AUTHORIZATION' && f.method === 'email') {
        if (!f.to) missing.push('to');
        if (!f.subject) missing.push('subject');
        if (!f.message) missing.push('message');
      }
      if (missing.length) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam: ${missing.join(', ')}.`,
          nextRequiredFields: missing,
        });
      }
      const { text } = await draftService.getPreview(
        context.conversationId,
        'contestation',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };
}
