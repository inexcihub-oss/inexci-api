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

export function buildConfirmReceiptTool(deps: WhatsappFlowToolDeps): AiTool {
  const { surgeryRequestRepo, workflowService, activityRepo } = deps;
  return {
    name: 'confirm_receipt',
    definition: {
      type: 'function',
      function: {
        name: 'confirm_receipt',
        description:
          'Confirma o recebimento financeiro de uma solicitação faturada. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            receivedValue: { type: 'number', description: 'Valor recebido' },
            receivedAt: {
              type: 'string',
              description: 'Data do recebimento (ISO)',
            },
            receiptNotes: {
              type: 'string',
              description: 'Observações do recebimento (opcional)',
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

      if (args.receiptNotes != null && typeof args.receiptNotes !== 'string') {
        return buildToolResult({
          status: 'needs_input',
          message: 'Parâmetro inválido: `receiptNotes` deve ser texto.',
          nextRequiredFields: ['receiptNotes'],
        });
      }

      if (!args.confirm) {
        const preview = `A solicitação ${auth.request.protocol} terá o recebimento confirmado:\n• Valor: R$ ${value.toFixed(2)}\n• Data: ${formatDatePtBr(receivedAt)}\n\nConfirme com "sim" para executar.`;
        return buildToolResult({
          status: 'pending_confirmation',
          message: preview,
          pendingConfirmation: {
            tool: 'confirm_receipt',
            args: { ...args, confirm: true },
            description: 'confirmar o recebimento',
          },
        });
      }

      try {
        await workflowService.confirmReceipt(
          auth.request.id,
          {
            receivedValue: value,
            receivedAt: receivedAt,
            receiptNotes: args.receiptNotes,
          },
          context.userId as string,
        );

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Recebimento confirmado. Valor: ${value.toFixed(2)}, data: ${receivedAt}.`,
        });

        return buildToolResult({
          status: 'ok',
          message: `✅ Recebimento confirmado com sucesso para a solicitação ${auth.request.protocol}.`,
          affected: [{ kind: 'surgery_request', id: auth.request.id }],
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao confirmar recebimento: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };
}
