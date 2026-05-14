import OpenAI from 'openai';
import { AiTool } from '../tool.interface';
import { ActivityType } from '../../../../database/entities/surgery-request-activity.entity';
import { buildToolResult } from '../tool-result';
import { WhatsappFlowToolDeps } from './_types';
import {
  asNonNegativeNumber,
  asValidDateString,
  formatDatePtBr,
  getAuthorizedRequest,
} from './_helpers';

export function buildUpdateReceiptTool(deps: WhatsappFlowToolDeps): AiTool {
  const { surgeryRequestRepo, workflowService, activityRepo } = deps;
  return {
    name: 'update_receipt',
    definition: {
      type: 'function',
      function: {
        name: 'update_receipt',
        description:
          'Atualiza dados de recebimento (valor e data) após faturamento/finalização. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            receivedValue: {
              type: 'number',
              description: 'Novo valor recebido',
            },
            receivedAt: {
              type: 'string',
              description: 'Nova data de recebimento (ISO)',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a ação. Caso contrário, mostra preview.',
            },
          },
          required: ['surgeryRequestId', 'receivedValue', 'receivedAt'],
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

      const value = asNonNegativeNumber(args.receivedValue);
      const receivedAt = asValidDateString(args.receivedAt);

      if (value === null) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Parâmetro inválido: `receivedValue` deve ser número maior ou igual a 0.',
          nextRequiredFields: ['receivedValue'],
        });
      }
      if (!receivedAt) {
        return buildToolResult({
          status: 'needs_input',
          message: 'Parâmetro inválido: `receivedAt` deve ser uma data válida.',
          nextRequiredFields: ['receivedAt'],
        });
      }

      if (!args.confirm) {
        const preview = `A solicitação ${auth.request.protocol} terá recebimento atualizado para:\n• Valor: R$ ${value.toFixed(2)}\n• Data: ${formatDatePtBr(receivedAt)}\n\nConfirme com "sim" para executar.`;
        return buildToolResult({
          status: 'pending_confirmation',
          message: preview,
          pendingConfirmation: {
            tool: 'update_receipt',
            args: { ...args, confirm: true },
            description: 'atualizar os dados de recebimento',
          },
        });
      }

      try {
        await workflowService.updateReceipt(
          auth.request.id,
          {
            receivedValue: value,
            receivedAt: receivedAt,
          },
          context.userId as string,
        );

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Recebimento atualizado. Valor: ${value.toFixed(2)}, data: ${receivedAt}.`,
        });

        return buildToolResult({
          status: 'ok',
          message: `✅ Recebimento atualizado com sucesso para a solicitação ${auth.request.protocol}.`,
          affected: [{ kind: 'surgery_request', id: auth.request.id }],
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao atualizar recebimento: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };
}
