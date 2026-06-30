import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { ActivityType } from '../../../../../database/entities/surgery-request-activity.entity';
import { SurgeryRequestStatus } from '../../../../../database/entities/surgery-request.entity';
import { FlowDraftTransitionDeps } from '../_types';
import { assertCurrentStatusIs, checkPostSurgeryDocuments, extractTransitionErrorMessage } from '../_helpers';

export function buildMarkPerformedDraftCommitTool(
  deps: FlowDraftTransitionDeps,
): AiTool {
  const {
    draftService,
    workflowService,
    activityRepo,
    surgeryRequestRepo,
    documentRepo,
  } = deps;
  return {
    name: 'mark_performed_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'mark_performed_draft_commit',
        description:
          'Marca a cirurgia como realizada após confirmação (`confirm=true`). Avança status SCHEDULED → PERFORMED.',
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
            'Para marcar como realizada, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'mark_performed',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      const status = await assertCurrentStatusIs(
        surgeryRequestRepo,
        f.surgeryRequestId!,
        SurgeryRequestStatus.SCHEDULED,
      );
      if (status.error) return status.error;
      const surgeryRequestId = status.resolvedId!;

      const docs = await checkPostSurgeryDocuments(
        documentRepo,
        surgeryRequestId,
      );
      if (docs.missing.length > 0) {
        return buildToolResult({
          status: 'blocked',
          message: `Documentos cirúrgicos faltantes: ${docs.missing.map((d) => d.label).join(', ')}.`,
        });
      }

      try {
        await workflowService.markPerformed(
          surgeryRequestId,
          { surgeryPerformedAt: f.surgeryPerformedAt!, notifyPatient: f.notifyPatient } as any,
          context.userId,
        );
        await activityRepo.create({
          surgeryRequestId,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Cirurgia marcada como realizada em ${f.surgeryPerformedAt}.`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          message: `Solicitação ${f.surgeryRequestLabel ?? surgeryRequestId} marcada como realizada com sucesso.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: extractTransitionErrorMessage(err, 'Erro ao marcar como realizada'),
        });
      }
    },
  };
}
