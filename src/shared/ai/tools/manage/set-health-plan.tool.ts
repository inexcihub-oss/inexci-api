import { AiTool, ToolContext } from '../tool.interface';
import { Permission } from 'src/shared/permissions';
import { detokenizeArg, tokenizePii } from '../../pii/tool-pii-helpers';
import { buildToolResult } from '../tool-result';
import { ManageToolDeps } from './_types';
import { asNonEmptyString, asScalarArg } from '../helpers/arg-parsers';
import { HealthPlan } from '../../../../database/entities/health-plan.entity';
import {
  ensurePendingForMutation,
  getAuthorizedRequest,
  recordAiActivity,
} from '../helpers/surgery-request-access';

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
    requiredPermission: Permission.SOLICITACOES,
    mutates: true,
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
    },
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
        await recordAiActivity(
          activityRepo,
          context,
          auth.request.id,
          'Convênio removido da solicitação.',
        );
        return buildToolResult({
          status: 'ok',
          message: `Convênio removido com sucesso da solicitação SC-${protocolToken}.`,
          affected: [{ kind: 'surgery_request', id: auth.request.id }],
        });
      }

      const healthPlanId = asNonEmptyString(args.healthPlanId);
      const healthPlanName = asNonEmptyString(
        detokenizeArg(context, asScalarArg(args.health_plan_name)),
      );

      if (!healthPlanId && !healthPlanName) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Para definir o convênio, informe `healthPlanId` ou `health_plan_name`. Para remover, use `clear=true`.',
          nextRequiredFields: ['healthPlanId'],
        });
      }

      let selected: HealthPlan | null = null;
      if (healthPlanId) {
        selected = await healthPlanRepo.findOne({
          id: healthPlanId,
          ownerId: auth.request.ownerId,
        });
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
        });
        if (!selected) {
          const candidates = await healthPlanRepo.findMany(
            { ownerId: auth.request.ownerId },
            0,
            200,
          );
          const result = entityResolver.resolve({
            query: healthPlanName,
            candidates,
            getName: (h) => String(h.name ?? ''),
            getId: (h) => String(h.id),
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

      if (!selected) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Para definir o convênio, informe `healthPlanId` ou `health_plan_name`. Para remover, use `clear=true`.',
          nextRequiredFields: ['healthPlanId'],
        });
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

      await recordAiActivity(
        activityRepo,
        context,
        auth.request.id,
        `Convênio definido para ${selected.name}.`,
      );

      return buildToolResult({
        status: 'ok',
        message: `Convênio atualizado com sucesso para ${previewName} na solicitação SC-${protocolToken}.`,
        affected: [{ kind: 'surgery_request', id: auth.request.id }],
      });
    },
  };
}
