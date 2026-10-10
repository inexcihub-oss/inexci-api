import { AiTool } from '../../tool.interface';
import { Permission } from 'src/shared/permissions';
import { buildToolResult } from '../../tool-result';
import { FlowDraftDeps } from '../_types';
import { recordAiActivity } from '../../helpers/surgery-request-access';
import { errorMessage } from '../../../../utils/error-message.util';
import { UpdateDateOptionsDto } from '../../../../../modules/surgery-requests/dto/update-date-options.dto';
import { ConfirmDateDto } from '../../../../../modules/surgery-requests/dto/confirm-date.dto';

export function buildSchedulingDraftCommitTool(deps: FlowDraftDeps): AiTool {
  const { draftService, workflowService, activityRepo } = deps;
  return {
    name: 'scheduling_draft_commit',
    requiredPermission: Permission.SOLICITACOES,
    mutates: true,
    definition: {
      type: 'function',
      function: {
        name: 'scheduling_draft_commit',
        description:
          'Aplica o agendamento após confirmação (`confirm=true`). Se `dateOptions` está preenchido, atualiza as opções. Se `confirmedDateIndex` está preenchido, confirma a data.',
        parameters: {
          type: 'object',
          properties: { confirm: { type: 'boolean' } },
          required: ['confirm'],
        },
      },
    },
    async execute(args, context) {
      if (!context.userId) {
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      }
      if (!args.confirm) {
        return buildToolResult({
          status: 'pending_confirmation',
          message:
            'Para aplicar o agendamento, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'scheduling',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de agendamento ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      try {
        const hasOptions =
          Array.isArray(f.dateOptions) && f.dateOptions.length > 0;
        if (hasOptions) {
          await workflowService.updateDateOptions(
            f.surgeryRequestId!,
            { dateOptions: f.dateOptions } as UpdateDateOptionsDto,
            context.userId,
          );
        }
        if (f.confirmedDateIndex !== undefined) {
          await workflowService.confirmDate(
            f.surgeryRequestId!,
            { selectedDateIndex: f.confirmedDateIndex } as ConfirmDateDto,
            context.userId,
          );
        }
        await recordAiActivity(
          activityRepo,
          context,
          f.surgeryRequestId!,
          `Agendamento: ${hasOptions ? 'opções definidas' : ''}${
            f.confirmedDateIndex !== undefined
              ? `${hasOptions ? '; ' : ''}data confirmada (opção #${f.confirmedDateIndex + 1})`
              : ''
          }.`,
        );
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          affected: [{ kind: 'surgery_request', id: f.surgeryRequestId! }],
          message: `Agendamento aplicado para a solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId}.`,
        });
      } catch (err) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao agendar: ${errorMessage(err) || 'erro desconhecido'}`,
        });
      }
    },
  };
}
