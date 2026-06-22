import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { FlowDraftTransitionDeps } from '../_types';
import { checkPostSurgeryDocuments, guardDraft } from '../_helpers';

export function buildMarkPerformedDraftCheckDocsTool(
  deps: FlowDraftTransitionDeps,
): AiTool {
  const { draftService, documentRepo } = deps;
  return {
    name: 'mark_performed_draft_check_docs',
    definition: {
      type: 'function',
      function: {
        name: 'mark_performed_draft_check_docs',
        description:
          'Verifica quais documentos pós-cirúrgicos já estão anexados à SC e quais ainda faltam (todos opcionais).',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const blocked = await guardDraft(draftService, context, 'mark_performed');
      if (blocked) return blocked;
      const draft = await draftService.getCurrentOfType(
        context.conversationId,
        'mark_performed',
      );
      if (!draft?.fields.surgeryRequestId) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Defina a solicitação primeiro com `draft_update(mark_performed, surgeryRequestId, <UUID>)`.',
          nextRequiredFields: ['surgeryRequestId'],
        });
      }
      const result = await checkPostSurgeryDocuments(
        documentRepo,
        draft.fields.surgeryRequestId,
      );
      return buildToolResult({
        status: result.missing.length === 0 ? 'ok' : 'needs_input',
        data: {
          presentKeys: result.present,
          missing: result.missing.map((d) => ({
            type: d.type,
            label: d.label,
            hint: d.hint,
          })),
        },
        message:
          result.missing.length === 0
            ? 'Nenhum documento pós-cirúrgico obrigatório pendente — pode prosseguir com preview/commit.'
            : `Faltam ${result.missing.length} documento(s) recomendado(s): ${result.missing.map((d) => d.label).join(', ')}.`,
      });
    },
  };
}
