import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestWorkflowService } from '../../../modules/surgery-requests/services/surgery-request-workflow.service';
import { SurgeryRequestMutationService } from '../../../modules/surgery-requests/services/surgery-request-mutation.service';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { ActivityType } from '../../../database/entities/surgery-request-activity.entity';
import { SurgeryRequestPriority } from '../../../database/entities/surgery-request.entity';

const STATUS_LABELS: Record<number, string> = {
  1: 'Pendente',
  2: 'Enviada',
  3: 'Em Análise',
  4: 'Em Agendamento',
  5: 'Agendada',
  6: 'Realizada',
  7: 'Faturada',
  8: 'Finalizada',
  9: 'Encerrada',
};

const NEXT_STATUS: Record<number, number> = {
  1: 2,
  2: 3,
  3: 4,
  4: 5,
  5: 6,
  6: 7,
  7: 8,
};

export function buildActionTools(
  surgeryRequestRepo: SurgeryRequestRepository,
  workflowService: SurgeryRequestWorkflowService,
  mutationService: SurgeryRequestMutationService,
  pendencyValidator: PendencyValidatorService,
  activityRepo: SurgeryRequestActivityRepository,
): AiTool[] {
  const advanceSurgeryRequest: AiTool = {
    name: 'advance_surgery_request',
    definition: {
      type: 'function',
      function: {
        name: 'advance_surgery_request',
        description:
          'Avança uma solicitação cirúrgica para a próxima etapa do fluxo. Só funciona se todas as pendências bloqueantes estiverem resolvidas. IMPORTANTE: sempre pergunte ao usuário se ele confirma antes de executar.',
        parameters: {
          type: 'object',
          properties: {
            surgery_request_id: {
              type: 'string',
              description: 'ID da solicitação',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a transição. Se false ou omitido, apenas mostra o que seria feito.',
            },
          },
          required: ['surgery_request_id'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Você precisa estar cadastrado para executar esta ação.';

      const request = await surgeryRequestRepo.findOneSimple({
        id: args.surgery_request_id as string,
      });

      if (!request) return 'Solicitação não encontrada.';
      if (!context.accessibleDoctorIds.includes(request.doctor_id)) {
        return 'Você não tem permissão para acessar essa solicitação.';
      }

      const canAdvance = await pendencyValidator.canAdvance(args.surgery_request_id as string);
      const currentLabel = STATUS_LABELS[request.status] || String(request.status);
      const nextStatus = NEXT_STATUS[request.status];
      const nextLabel = nextStatus ? STATUS_LABELS[nextStatus] : null;

      if (!canAdvance) {
        return `⚠️ A solicitação ${request.protocol} ainda tem pendências bloqueantes e não pode avançar. Consulte as pendências com "get_pendencies".`;
      }

      if (!nextLabel) {
        return `A solicitação ${request.protocol} já está no status final: ${currentLabel}.`;
      }

      if (!args.confirm) {
        return `A solicitação *${request.protocol}* será avançada de *${currentLabel}* para *${nextLabel}*.\n\nDeseja confirmar? Responda "sim" para prosseguir.`;
      }

      try {
        // Avança conforme o status atual
        switch (request.status) {
          case 1:
            await workflowService.sendRequest(args.surgery_request_id as string, {} as any, context.userId);
            break;
          case 2:
            await workflowService.startAnalysis(args.surgery_request_id as string, {} as any, context.userId);
            break;
          case 3:
            await workflowService.acceptAuthorization(args.surgery_request_id as string, {} as any, context.userId);
            break;
          default:
            return `Avanço automático para o status ${nextLabel} não suportado via WhatsApp. Acesse a plataforma web.`;
        }
        await activityRepo.create({
          surgery_request_id: args.surgery_request_id as string,
          user_id: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Solicitação avançada de "${currentLabel}" para "${nextLabel}".`,
        });
        return `✅ Solicitação *${request.protocol}* avançada de *${currentLabel}* para *${nextLabel}* com sucesso!`;
      } catch (err: any) {
        return `Erro ao avançar a solicitação: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const setHasOpme: AiTool = {
    name: 'set_has_opme',
    definition: {
      type: 'function',
      function: {
        name: 'set_has_opme',
        description: 'Define se a solicitação possui OPME.',
        parameters: {
          type: 'object',
          properties: {
            surgery_request_id: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            has_opme: {
              type: 'boolean',
              description: 'True se possui OPME, false caso contrário',
            },
            confirm: {
              type: 'boolean',
              description: 'Confirmação do usuário',
            },
          },
          required: ['surgery_request_id', 'has_opme'],
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
        return `Deseja ${args.has_opme ? 'marcar' : 'desmarcar'} a solicitação ${request.protocol} como ${args.has_opme ? 'possuindo' : 'não possuindo'} OPME? Confirme com "sim".`;
      }

      await mutationService.setHasOpme(
        args.surgery_request_id as string,
        args.has_opme as boolean,
        context.userId,
      );

      await activityRepo.create({
        surgery_request_id: args.surgery_request_id as string,
        user_id: context.userId,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] OPME definido como: ${args.has_opme ? 'Sim' : 'Não'}.`,
      });

      return `✅ Solicitação ${request.protocol} atualizada: OPME = ${args.has_opme ? 'Sim' : 'Não'}.`;
    },
  };

  const closeSurgeryRequest: AiTool = {
    name: 'close_surgery_request',
    definition: {
      type: 'function',
      function: {
        name: 'close_surgery_request',
        description: 'Encerra (cancela) uma solicitação cirúrgica. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgery_request_id: {
              type: 'string',
              description: 'ID da solicitação',
            },
            reason: {
              type: 'string',
              description: 'Motivo do encerramento',
            },
            confirm: {
              type: 'boolean',
              description: 'Confirmação explícita do usuário',
            },
          },
          required: ['surgery_request_id', 'reason'],
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
        return `⚠️ Você está prestes a *encerrar* a solicitação ${request.protocol}.\nMotivo: "${args.reason}"\n\nEssa ação não pode ser desfeita. Confirme com "sim".`;
      }

      try {
        await workflowService.closeSurgeryRequest(
          args.surgery_request_id as string,
          { reason: args.reason as string } as any,
          context.userId,
        );
        await activityRepo.create({
          surgery_request_id: args.surgery_request_id as string,
          user_id: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Solicitação encerrada. Motivo: "${args.reason}".`,
        });
        return `✅ Solicitação ${request.protocol} encerrada com sucesso.`;
      } catch (err: any) {
        return `Erro ao encerrar: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const PRIORITY_LABELS: Record<number, string> = {
    1: 'Baixa',
    2: 'Média',
    3: 'Alta',
    4: 'Urgente',
  };

  const updateSurgeryRequestData: AiTool = {
    name: 'update_surgery_request_data',
    definition: {
      type: 'function',
      function: {
        name: 'update_surgery_request_data',
        description:
          'Atualiza dados básicos de uma solicitação cirúrgica: prioridade e/ou prazo (deadline). IMPORTANTE: sempre confirme com o usuário antes de executar.',
        parameters: {
          type: 'object',
          properties: {
            surgery_request_id: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            priority: {
              type: 'number',
              description: 'Prioridade: 1=Baixa, 2=Média, 3=Alta, 4=Urgente',
            },
            deadline: {
              type: 'string',
              description: 'Prazo no formato ISO 8601 (ex: 2025-06-30)',
            },
            confirm: {
              type: 'boolean',
              description: 'Se true, aplica as alterações. Se false/omitido, apenas mostra o preview.',
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

      if (args.priority !== undefined && ![1, 2, 3, 4].includes(args.priority as number)) {
        return 'Prioridade inválida. Use 1=Baixa, 2=Média, 3=Alta, 4=Urgente.';
      }

      const changes: string[] = [];
      if (args.priority !== undefined) {
        changes.push(`Prioridade: ${PRIORITY_LABELS[args.priority as number]}`);
      }
      if (args.deadline !== undefined) {
        const d = new Date(args.deadline as string);
        changes.push(`Prazo: ${d.toLocaleDateString('pt-BR')}`);
      }

      if (!changes.length) {
        return 'Nenhuma alteração especificada. Informe ao menos prioridade ou prazo.';
      }

      if (!args.confirm) {
        return `Você deseja atualizar a solicitação *${request.protocol}* com:\n${changes.map(c => `• ${c}`).join('\n')}\n\nConfirme com "sim".`;
      }

      await mutationService.updateBasic(
        {
          id: args.surgery_request_id as string,
          priority: args.priority as SurgeryRequestPriority | undefined,
          deadline: args.deadline as string | undefined,
        },
        context.userId,
      );

      await activityRepo.create({
        surgery_request_id: args.surgery_request_id as string,
        user_id: context.userId,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Dados atualizados: ${changes.join(', ')}.`,
      });

      return `✅ Solicitação *${request.protocol}* atualizada:\n${changes.map(c => `• ${c}`).join('\n')}`;
    },
  };

  return [advanceSurgeryRequest, setHasOpme, closeSurgeryRequest, updateSurgeryRequestData];
}
