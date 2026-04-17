import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestNotificationService } from '../../../modules/surgery-requests/services/surgery-request-notification.service';
import { ActivityType } from '../../../database/entities/surgery-request-activity.entity';

export function buildNotificationTools(
  surgeryRequestRepo: SurgeryRequestRepository,
  notificationService: SurgeryRequestNotificationService,
  activityRepo: SurgeryRequestActivityRepository,
): AiTool[] {
  const sendNotification: AiTool = {
    name: 'send_notification',
    definition: {
      type: 'function',
      function: {
        name: 'send_notification',
        description:
          'Envia uma notificação sobre uma solicitação cirúrgica (ex: atualização de status ao convênio ou hospital).',
        parameters: {
          type: 'object',
          properties: {
            surgery_request_id: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            confirm: {
              type: 'boolean',
              description: 'Confirmação do usuário para enviar a notificação',
            },
          },
          required: ['surgery_request_id'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const request = await surgeryRequestRepo.findOneSimple({
        id: args.surgery_request_id as string,
      });

      if (!request) return 'Solicitação não encontrada.';
      if (!context.accessibleDoctorIds.includes(request.doctor_id)) {
        return 'Você não tem permissão para acessar essa solicitação.';
      }

      if (!args.confirm) {
        return `Deseja enviar uma notificação de atualização para a solicitação ${request.protocol}? Confirme com "sim".`;
      }

      try {
        await notificationService.notify(
          args.surgery_request_id as string,
          {} as any,
          context.userId,
        );
        await activityRepo.create({
          surgery_request_id: args.surgery_request_id as string,
          user_id: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Notificação de status enviada.`,
        });
        return `✅ Notificação enviada para a solicitação ${request.protocol}.`;
      } catch (err: any) {
        return `Erro ao enviar notificação: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  return [sendNotification];
}
