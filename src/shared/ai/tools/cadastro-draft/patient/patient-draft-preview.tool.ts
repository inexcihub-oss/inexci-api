import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { CadastroDraftDeps } from '../_types';

export function buildPatientDraftPreviewTool(deps: CadastroDraftDeps): AiTool {
  const { draftService } = deps;
  return {
    name: 'patient_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'patient_draft_preview',
        description:
          'Gera o preview do rascunho de paciente para confirmar com o usuário.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'create_patient',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de paciente ativo.',
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
        'create_patient',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };
}
