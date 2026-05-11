import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestNotificationService } from '../../../modules/surgery-requests/services/surgery-request-notification.service';
import { ActivityType } from '../../../database/entities/surgery-request-activity.entity';
import { detokenizeArg } from '../pii/tool-pii-helpers';
import { buildProtocolCandidates } from './protocol.helpers';

function sanitizeIdentifier(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/[\s.,;:!?]+$/g, '');
}

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
      if (!context.userId) return 'Acesso negado.';

      const detokenized = detokenizeArg(context, args.surgeryRequestId as any);
      const identifier = sanitizeIdentifier(
        detokenized ?? (args.surgeryRequestId as any),
      );
      if (!identifier) return 'Parâmetro inválido: informe a solicitação.';

      let request: any | null = null;
      if (identifier.match(/^[0-9a-f-]{36}$/i)) {
        request = await surgeryRequestRepo.findOneSimple({ id: identifier });
      }
      if (!request) {
        for (const candidate of buildProtocolCandidates(identifier)) {
          request = await surgeryRequestRepo.findOneSimple({
            protocol: candidate,
          });
          if (request) break;
        }
      }

      if (!request) return 'Solicitação não encontrada.';
      if (!context.accessibleDoctorIds.includes(request.doctorId)) {
        return 'Você não tem permissão para acessar essa solicitação.';
      }

      if (!args.confirm) {
        return `Deseja enviar uma notificação de atualização para a solicitação ${request.protocol}? Confirme com "sim".`;
      }

      try {
        await notificationService.notify(request.id, {} as any, context.userId);
        await activityRepo.create({
          surgeryRequestId: request.id,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Notificação de status enviada.`,
        });
        return `Notificação enviada para a solicitação ${request.protocol}.`;
      } catch (err: any) {
        return `Erro ao enviar notificação: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  return [sendNotification];
}
