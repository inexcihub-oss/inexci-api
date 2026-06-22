import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { FlowDraftTransitionDeps } from '../_types';
import { checkPostSurgeryDocuments } from '../_helpers';

export function buildMarkPerformedDraftPreviewTool(
  deps: FlowDraftTransitionDeps,
): AiTool {
  const { draftService, documentRepo } = deps;
  return {
    name: 'mark_performed_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'mark_performed_draft_preview',
        description:
          'Gera o preview da marcação como realizada. Documentos pós-cirúrgicos são opcionais.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'mark_performed',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de marcação de realizada ativo.',
        });
      }
      if (!v.isReady) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam: ${v.missing.join(', ')}.`,
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      const docs = await checkPostSurgeryDocuments(
        documentRepo,
        f.surgeryRequestId!,
      );
      if (docs.missing.length > 0) {
        const lines = docs.missing
          .map((d) => `• ${d.label} — ${d.hint}`)
          .join('\n');
        return buildToolResult({
          status: 'blocked',
          message: `Para marcar como realizada, os seguintes documentos precisam estar anexados à SC (envie pelo WhatsApp como anexo ou pela plataforma):\n${lines}`,
        });
      }
      const { text } = await draftService.getPreview(
        context.conversationId,
        'mark_performed',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };
}
