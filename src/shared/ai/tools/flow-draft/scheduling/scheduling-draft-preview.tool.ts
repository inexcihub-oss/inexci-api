import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { FlowDraftDeps } from '../_types';

export function buildSchedulingDraftPreviewTool(deps: FlowDraftDeps): AiTool {
  const { draftService } = deps;
  return {
    name: 'scheduling_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'scheduling_draft_preview',
        description: 'Gera o preview do rascunho de agendamento.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'scheduling',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de agendamento ativo.',
        });
      }
      const f = v.draft.fields;
      // Agendamento exige: ou `dateOptions` (para enviar opções) ou
      // `confirmedDateIndex`/`confirmedDate` (para confirmar uma data).
      const hasDateOptions =
        Array.isArray(f.dateOptions) && f.dateOptions.length > 0;
      const hasConfirmation =
        f.confirmedDateIndex !== undefined || !!f.confirmedDate;
      if (!hasDateOptions && !hasConfirmation) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Informe `dateOptions` (1 a 3 datas) ou confirme uma data (`confirmedDateIndex`/`confirmedDate`).',
          nextRequiredFields: ['dateOptions', 'confirmedDateIndex'],
        });
      }
      const { text } = await draftService.getPreview(
        context.conversationId,
        'scheduling',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };
}
