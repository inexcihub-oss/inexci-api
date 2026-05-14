import OpenAI from 'openai';
import { AiTool } from '../tool.interface';
import { ActivityType } from '../../../../database/entities/surgery-request-activity.entity';
import { detokenizeArg, tokenizePii } from '../../pii/tool-pii-helpers';
import { buildToolResult } from '../tool-result';
import { WhatsappFlowToolDeps } from './_types';
import {
  asNonEmptyString,
  ensurePendingForMutation,
  getAuthorizedRequest,
} from './_helpers';

export function buildSetHospitalTool(deps: WhatsappFlowToolDeps): AiTool {
  const {
    surgeryRequestRepo,
    surgeryRequestsService,
    activityRepo,
    hospitalRepo,
    entityResolver,
  } = deps;
  return {
    name: 'set_hospital',
    definition: {
      type: 'function',
      function: {
        name: 'set_hospital',
        description:
          'Define, troca ou remove o hospital vinculado à solicitação. Aceita `hospitalId` ou `hospital_name` (deve estar cadastrado na clínica). Para remover, use `clear=true`. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: { type: 'string' },
            hospitalId: { type: 'string' },
            hospital_name: { type: 'string' },
            clear: {
              type: 'boolean',
              description: 'Se true, remove o hospital da solicitação.',
            },
            confirm: { type: 'boolean' },
          },
          required: ['surgeryRequestId'],
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
      if (!hospitalRepo) {
        return buildToolResult({
          status: 'blocked',
          message: 'Ferramenta indisponível no momento.',
        });
      }

      const protocolToken = tokenizePii(
        context,
        'set_hospital',
        'protocol',
        auth.request.protocol,
      );

      const blockedMutation = ensurePendingForMutation(auth.request);
      if (blockedMutation) {
        return buildToolResult({ status: 'blocked', message: blockedMutation });
      }

      if (args.clear === true) {
        if (!args.confirm) {
          const preview = `O hospital será removido da solicitação ${protocolToken}. Confirme com "sim" para executar.`;
          return buildToolResult({
            status: 'pending_confirmation',
            message: preview,
            pendingConfirmation: {
              tool: 'set_hospital',
              args: { ...args, confirm: true },
              description: 'remover o hospital da solicitação',
            },
          });
        }
        try {
          await surgeryRequestsService.updateBasic(
            { id: auth.request.id, hospitalId: null },
            context.userId as string,
          );
        } catch (err) {
          return buildToolResult({
            status: 'error',
            message: `Erro ao remover hospital: ${err instanceof Error ? err.message : 'erro desconhecido'}.`,
          });
        }
        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: '[WhatsApp IA] Hospital removido da solicitação.',
        });
        return buildToolResult({
          status: 'ok',
          message: `Hospital removido com sucesso da solicitação ${protocolToken}.`,
          affected: [{ kind: 'surgery_request', id: auth.request.id }],
        });
      }

      const hospitalId = asNonEmptyString(args.hospitalId);
      const hospitalName = asNonEmptyString(
        detokenizeArg(context, args.hospital_name),
      );

      if (!hospitalId && !hospitalName) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Parâmetro inválido: informe `hospitalId` ou `hospital_name`. Para remover, use `clear=true`.',
          nextRequiredFields: ['hospitalId'],
        });
      }

      let selectedHospital: any = null;

      if (hospitalId) {
        selectedHospital = await hospitalRepo.findOne({
          id: hospitalId,
          ownerId: auth.request.ownerId,
        } as any);
        if (!selectedHospital) {
          return buildToolResult({
            status: 'blocked',
            message:
              'Hospital não encontrado para essa clínica. Verifique o `hospitalId`.',
          });
        }
      } else if (hospitalName) {
        selectedHospital = await hospitalRepo.findOne({
          name: hospitalName,
          ownerId: auth.request.ownerId,
        } as any);
        if (!selectedHospital && entityResolver) {
          const candidates = await hospitalRepo.findMany(
            { ownerId: auth.request.ownerId } as any,
            0,
            200,
          );
          const result = entityResolver.resolve<any>({
            query: hospitalName,
            candidates,
            getName: (h: any) => String(h.name ?? ''),
            getId: (h: any) => String(h.id),
          });
          if (result.status === 'resolved' && result.resolved) {
            selectedHospital = result.resolved.data;
          } else if (result.status === 'ambiguous') {
            const top = result.candidates
              .slice(0, 5)
              .map((c) => `• ${c.label}`)
              .join('\n');
            return buildToolResult({
              status: 'needs_input',
              message: `Encontrei vários hospitais parecidos com "${hospitalName}":\n${top}\nResponda com o nome exato ou o ID.`,
              nextRequiredFields: ['hospitalId'],
            });
          }
        }
        if (!selectedHospital) {
          return buildToolResult({
            status: 'blocked',
            message: `Hospital "${hospitalName}" não encontrado para essa clínica. Cadastre-o antes ou informe o \`hospitalId\`.`,
          });
        }
      }

      const previewName = String(selectedHospital.name);

      if (!args.confirm) {
        const preview = `A solicitação ${protocolToken} terá o hospital atualizado para ${previewName}. Confirme com "sim" para executar.`;
        return buildToolResult({
          status: 'pending_confirmation',
          message: preview,
          pendingConfirmation: {
            tool: 'set_hospital',
            args: { ...args, hospitalId: selectedHospital.id, confirm: true },
            description: 'atualizar o hospital da solicitação',
          },
        });
      }

      try {
        await surgeryRequestsService.updateBasic(
          { id: auth.request.id, hospitalId: selectedHospital.id },
          context.userId as string,
        );
      } catch (err) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao atualizar hospital: ${err instanceof Error ? err.message : 'erro desconhecido'}.`,
        });
      }

      return buildToolResult({
        status: 'ok',
        message: `Hospital atualizado com sucesso para ${previewName} na solicitação ${protocolToken}.`,
        affected: [{ kind: 'surgery_request', id: auth.request.id }],
      });
    },
  };
}
