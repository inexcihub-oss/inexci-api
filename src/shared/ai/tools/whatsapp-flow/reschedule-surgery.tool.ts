import OpenAI from 'openai';
import { AiTool } from '../tool.interface';
import { ActivityType } from '../../../../database/entities/surgery-request-activity.entity';
import { buildToolResult } from '../tool-result';
import { WhatsappFlowToolDeps } from './_types';
import {
  asValidDateString,
  formatDatePtBr,
  getAuthorizedRequest,
} from './_helpers';

export function buildRescheduleSurgeryTool(deps: WhatsappFlowToolDeps): AiTool {
  const { surgeryRequestRepo, workflowService, activityRepo } = deps;
  return {
    name: 'reschedule_surgery',
    definition: {
      type: 'function',
      function: {
        name: 'reschedule_surgery',
        description:
          'Reagenda uma cirurgia para uma nova data. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            newDate: {
              type: 'string',
              description: 'Nova data da cirurgia em formato ISO',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a ação. Caso contrário, mostra preview.',
            },
          },
          required: ['surgeryRequestId', 'newDate'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) {
        return buildToolResult({ status: 'blocked', message: auth.message });
      }

      const newDate = asValidDateString(args.newDate);
      if (!newDate) {
        return buildToolResult({
          status: 'needs_input',
          message: 'Parâmetro inválido: `newDate` deve ser uma data válida.',
          nextRequiredFields: ['newDate'],
        });
      }

      if (!args.confirm) {
        const preview = `A solicitação ${auth.request.protocol} será reagendada para ${formatDatePtBr(newDate)}. Confirme com "sim" para executar.`;
        return buildToolResult({
          status: 'pending_confirmation',
          message: preview,
          pendingConfirmation: {
            tool: 'reschedule_surgery',
            args: { ...args, confirm: true },
            description: 'reagendar a cirurgia',
          },
        });
      }

      try {
        await workflowService.reschedule(
          auth.request.id,
          { newDate },
          context.userId as string,
        );

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Cirurgia reagendada para ${newDate}.`,
        });

        return buildToolResult({
          status: 'ok',
          message: `✅ Solicitação ${auth.request.protocol} reagendada com sucesso.`,
          affected: [{ kind: 'surgery_request', id: auth.request.id }],
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao reagendar cirurgia: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };
}
