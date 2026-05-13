import OpenAI from 'openai';
import { AiTool, ToolContext } from '../tool.interface';
import { ActivityType } from '../../../../database/entities/surgery-request-activity.entity';
import { detokenizeArg, tokenizePii } from '../../pii/tool-pii-helpers';
import { buildToolResult } from '../tool-result';
import { ManageToolDeps } from './_types';
import {
  asNonEmptyString,
  ensurePendingForMutation,
  getAuthorizedRequest,
} from './_helpers';

export function buildSetHealthPlanTool(deps: ManageToolDeps): AiTool {
  const {
    surgeryRequestRepo,
    surgeryRequestsService,
    activityRepo,
    healthPlanRepo,
    entityResolver,
  } = deps;
  return {
    name: 'set_health_plan',
    definition: {
      type: 'function',
      function: {
        name: 'set_health_plan',
        description:
          'Define, troca ou remove o convênio (plano de saúde) vinculado à solicitação. Aceita `healthPlanId` ou `health_plan_name`. Para remover, use `clear=true`. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description:
                'ID/Protocolo da solicitação (UUID, SC-XXXX ou número).',
            },
            healthPlanId: {
              type: 'string',
              description: 'ID do convênio já cadastrado.',
            },
            health_plan_name: {
              type: 'string',
              description: 'Nome exato do convênio cadastrado na clínica.',
            },
            clear: {
              type: 'boolean',
              description: 'Se true, remove o convênio vinculado à SC.',
            },
            confirm: {
              type: 'boolean',
              description: 'Obrigatório (true) para executar a mutação.',
            },
          },
          required: ['surgeryRequestId'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) {
        return buildToolResult({ status: 'blocked', message: auth.message });
      }

      const protocolToken = tokenizePii(
        context,
        'set_health_plan',
        'protocol',
        auth.request.protocol,
      );

      const blocked = ensurePendingForMutation(auth.request);
      if (blocked) {
        return buildToolResult({ status: 'blocked', message: blocked });
      }

      if (args.clear === true) {
        if (!args.confirm) {
          const preview = `O convênio será removido da solicitação SC-${protocolToken}. Confirme com "sim" para executar.`;
          return buildToolResult({
            status: 'pending_confirmation',
            message: preview,
            pendingConfirmation: {
              tool: 'set_health_plan',
              args: { ...args, confirm: true },
              description: 'remover o convênio da solicitação',
            },
          });
        }
        try {
          await surgeryRequestsService.updateBasic(
            { id: auth.request.id, healthPlanId: null },
            context.userId as string,
          );
        } catch (err) {
          return buildToolResult({
            status: 'error',
            message: `Erro ao remover convênio: ${err instanceof Error ? err.message : 'erro desconhecido'}.`,
          });
        }
        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: '[WhatsApp IA] Convênio removido da solicitação.',
        });
        return buildToolResult({
          status: 'ok',
          message: `Convênio removido com sucesso da solicitação SC-${protocolToken}.`,
          affected: [{ kind: 'surgery_request', id: auth.request.id }],
        });
      }

      const healthPlanId = asNonEmptyString(args.healthPlanId);
      const healthPlanName = asNonEmptyString(
        detokenizeArg(context, args.health_plan_name),
      );

      if (!healthPlanId && !healthPlanName) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Para definir o convênio, informe `healthPlanId` ou `health_plan_name`. Para remover, use `clear=true`.',
          nextRequiredFields: ['healthPlanId'],
        });
      }

      let selected: any = null;
      if (healthPlanId) {
        selected = await healthPlanRepo.findOne({
          id: healthPlanId,
          ownerId: auth.request.ownerId,
        } as any);
        if (!selected) {
          return buildToolResult({
            status: 'blocked',
            message:
              'Convênio não encontrado para essa clínica. Verifique o `healthPlanId`.',
          });
        }
      } else if (healthPlanName) {
        selected = await healthPlanRepo.findOne({
          name: healthPlanName,
          ownerId: auth.request.ownerId,
        } as any);
        if (!selected && entityResolver) {
          const candidates = await healthPlanRepo.findMany(
            { ownerId: auth.request.ownerId } as any,
            0,
            200,
          );
          const result = entityResolver.resolve<any>({
            query: healthPlanName,
            candidates,
            getName: (h: any) => String(h.name ?? ''),
            getId: (h: any) => String(h.id),
          });
          if (result.status === 'resolved' && result.resolved) {
            selected = result.resolved.data;
          } else if (result.status === 'ambiguous') {
            const top = result.candidates
              .slice(0, 5)
              .map((c) => `• ${c.label}`)
              .join('\n');
            return buildToolResult({
              status: 'needs_input',
              message: `Encontrei vários convênios parecidos com "${healthPlanName}":\n${top}\nResponda com o nome exato ou o ID.`,
              nextRequiredFields: ['healthPlanId'],
            });
          }
        }
        if (!selected) {
          return buildToolResult({
            status: 'blocked',
            message: `Convênio "${healthPlanName}" não encontrado para essa clínica. Cadastre-o antes ou informe o \`healthPlanId\`.`,
          });
        }
      }

      const previewName = String(selected.name);

      if (!args.confirm) {
        const preview = `A solicitação SC-${protocolToken} terá o convênio atualizado para ${previewName}. Confirme com "sim" para executar.`;
        return buildToolResult({
          status: 'pending_confirmation',
          message: preview,
          pendingConfirmation: {
            tool: 'set_health_plan',
            args: { ...args, healthPlanId: selected.id, confirm: true },
            description: 'atualizar o convênio da solicitação',
          },
        });
      }

      try {
        await surgeryRequestsService.updateBasic(
          { id: auth.request.id, healthPlanId: selected.id },
          context.userId as string,
        );
      } catch (err) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao atualizar convênio: ${err instanceof Error ? err.message : 'erro desconhecido'}.`,
        });
      }

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Convênio definido para ${selected.name}.`,
      });

      return buildToolResult({
        status: 'ok',
        message: `Convênio atualizado com sucesso para ${previewName} na solicitação SC-${protocolToken}.`,
        affected: [{ kind: 'surgery_request', id: auth.request.id }],
      });
    },
  };
}
