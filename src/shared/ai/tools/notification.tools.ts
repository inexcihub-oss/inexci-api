import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { Permission } from 'src/shared/permissions';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestNotificationService } from '../../../modules/surgery-requests/services/surgery-request-notification.service';
import { SurgeryRequestStatus } from '../../../database/entities/surgery-request.entity';
import { getStatusLabel } from '../../utils/status';
import {
  recordAiActivity,
  resolveAuthorizedRequest,
} from './helpers/surgery-request-access';
import { buildToolResult } from './tool-result';

type NotifyDto = Parameters<SurgeryRequestNotificationService['notify']>[1];

const STATUS_UPDATE_TEMPLATE: Partial<Record<SurgeryRequestStatus, string>> = {
  [SurgeryRequestStatus.SENT]: 'surgery-request-sent',
  [SurgeryRequestStatus.IN_ANALYSIS]: 'surgery-contested',
  [SurgeryRequestStatus.IN_SCHEDULING]: 'surgery-authorized',
  [SurgeryRequestStatus.SCHEDULED]: 'surgery-scheduled',
  [SurgeryRequestStatus.INVOICED]: 'invoice-sent',
  [SurgeryRequestStatus.FINALIZED]: 'payment-received',
};

export function buildNotificationTools(
  surgeryRequestRepo: SurgeryRequestRepository,
  notificationService: SurgeryRequestNotificationService,
  activityRepo: SurgeryRequestActivityRepository,
): AiTool[] {
  const sendNotification: AiTool = {
    name: 'send_notification',
    requiredPermission: Permission.SOLICITACOES,
    mutates: true,
    definition: {
      type: 'function',
      function: {
        name: 'send_notification',
        description:
          'Envia uma notificação sobre uma solicitação cirúrgica (ex: atualização de status ao convênio ou hospital).',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            confirm: {
              type: 'boolean',
              description: 'Confirmação do usuário para enviar a notificação',
            },
          },
          required: ['surgeryRequestId'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) {
        return buildToolResult({
          status: 'blocked',
          message: 'Acesso negado.',
        });
      }

      const auth = await resolveAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.request) {
        return buildToolResult({ status: 'blocked', message: auth.error });
      }
      const request = auth.request;

      const template = STATUS_UPDATE_TEMPLATE[request.status];
      if (!template) {
        return buildToolResult({
          status: 'blocked',
          message: `Não há notificação de atualização para solicitações em "${getStatusLabel(request.status)}".`,
        });
      }

      if (!args.confirm) {
        return buildToolResult({
          status: 'pending_confirmation',
          message: `Deseja enviar uma notificação de atualização para a solicitação ${request.protocol}? Confirme com "sim".`,
          pendingConfirmation: {
            tool: 'send_notification',
            args: { ...args, confirm: true },
            description: 'enviar a notificação da solicitação',
          },
        });
      }

      try {
        const dto: NotifyDto = { template };
        await notificationService.notify(request.id, dto, context.userId);
        await recordAiActivity(
          activityRepo,
          context,
          request.id,
          'Notificação de status enviada.',
        );
        return buildToolResult({
          status: 'ok',
          message: `Notificação enviada para a solicitação ${request.protocol}.`,
          affected: [{ kind: 'surgery_request', id: request.id }],
        });
      } catch (err: unknown) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao enviar notificação: ${(err as Error)?.message || 'erro desconhecido'}`,
        });
      }
    },
  };

  return [sendNotification];
}
