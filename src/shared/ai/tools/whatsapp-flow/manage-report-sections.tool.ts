import { AiTool } from '../tool.interface';
import { Permission } from 'src/shared/permissions';
import { detokenizeArg } from '../../pii/tool-pii-helpers';
import { buildToolResult } from '../tool-result';
import { WhatsappFlowToolDeps } from './_types';
import { asNonEmptyString, asScalarArg } from '../helpers/arg-parsers';
import {
  ensurePendingForMutation,
  getAuthorizedRequest,
  recordAiActivity,
} from '../helpers/surgery-request-access';
import { errorMessage } from '../../../utils/error-message.util';

export function buildManageReportSectionsTool(
  deps: WhatsappFlowToolDeps,
): AiTool {
  const { surgeryRequestRepo, surgeryRequestsService, activityRepo } = deps;
  return {
    name: 'manage_report_sections',
    requiredPermission: Permission.SOLICITACOES,
    mutates: true,
    definition: {
      type: 'function',
      function: {
        name: 'manage_report_sections',
        description:
          'Gerencia seções do laudo: listar, criar, editar, excluir e reordenar.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            operation: {
              type: 'string',
              description: 'Operação: list, create, edit, delete ou reorder',
            },
            section_id: {
              type: 'string',
              description: 'ID da seção (obrigatório em edit/delete)',
            },
            title: {
              type: 'string',
              description: 'Título da seção (create/edit)',
            },
            description: {
              type: 'string',
              description: 'Descrição da seção (create/edit)',
            },
            ids: {
              type: 'array',
              description: 'Lista ordenada de IDs para reorder',
              items: { type: 'string' },
            },
            confirm: {
              type: 'boolean',
              description: 'Obrigatório para operações de mutação.',
            },
          },
          required: ['surgeryRequestId', 'operation'],
        },
      },
    },
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) {
        return buildToolResult({ status: 'blocked', message: auth.message });
      }

      const operation = asNonEmptyString(args.operation)?.toLowerCase();
      if (
        !operation ||
        !['list', 'create', 'edit', 'delete', 'reorder'].includes(operation)
      ) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Parâmetro inválido: `operation` deve ser list, create, edit, delete ou reorder.',
          nextRequiredFields: ['operation'],
        });
      }

      if (operation === 'list') {
        const sections = await surgeryRequestsService.getReportSections(
          auth.request.id,
          context.userId as string,
        );

        if (!sections.length) {
          return buildToolResult({
            status: 'ok',
            message: `Nenhuma seção de laudo cadastrada para a solicitação ${auth.request.protocol}.`,
            data: [],
          });
        }

        const lines = sections.map(
          (section, index) =>
            `${index + 1}. ${section.title} (id: ${section.id})${section.description ? `\n   ${section.description}` : ''}`,
        );

        return buildToolResult({
          status: 'ok',
          message: `Seções do laudo da solicitação ${auth.request.protocol}:\n${lines.join('\n')}`,
          data: sections,
        });
      }

      const blockedMutation = ensurePendingForMutation(auth.request);
      if (blockedMutation) {
        return buildToolResult({ status: 'blocked', message: blockedMutation });
      }

      if (!args.confirm) {
        switch (operation) {
          case 'create': {
            const title = asNonEmptyString(args.title);
            if (!title) {
              return buildToolResult({
                status: 'needs_input',
                message:
                  'Parâmetro inválido: `title` é obrigatório para create.',
                nextRequiredFields: ['title'],
              });
            }
            return buildToolResult({
              status: 'pending_confirmation',
              message: `Será criada uma nova seção de laudo na solicitação ${auth.request.protocol} com título "${title}". Confirme com "sim" para executar.`,
              pendingConfirmation: {
                tool: 'manage_report_sections',
                args: { ...args, confirm: true },
                description: 'criar seção do laudo',
              },
            });
          }
          case 'edit': {
            const sectionId = asNonEmptyString(args.section_id);
            if (!sectionId) {
              return buildToolResult({
                status: 'needs_input',
                message:
                  'Parâmetro inválido: `section_id` é obrigatório para edit.',
                nextRequiredFields: ['section_id'],
              });
            }
            if (args.title == null && args.description == null) {
              return buildToolResult({
                status: 'needs_input',
                message:
                  'Parâmetro inválido: informe `title` e/ou `description` para edit.',
                nextRequiredFields: ['title'],
              });
            }
            return buildToolResult({
              status: 'pending_confirmation',
              message: `A seção ${sectionId} da solicitação ${auth.request.protocol} será atualizada. Confirme com "sim" para executar.`,
              pendingConfirmation: {
                tool: 'manage_report_sections',
                args: { ...args, confirm: true },
                description: 'editar seção do laudo',
              },
            });
          }
          case 'delete': {
            const sectionId = asNonEmptyString(args.section_id);
            if (!sectionId) {
              return buildToolResult({
                status: 'needs_input',
                message:
                  'Parâmetro inválido: `section_id` é obrigatório para delete.',
                nextRequiredFields: ['section_id'],
              });
            }
            return buildToolResult({
              status: 'pending_confirmation',
              message: `A seção ${sectionId} da solicitação ${auth.request.protocol} será excluída. Confirme com "sim" para executar.`,
              pendingConfirmation: {
                tool: 'manage_report_sections',
                args: { ...args, confirm: true },
                description: 'excluir seção do laudo',
              },
            });
          }
          case 'reorder': {
            if (!Array.isArray(args.ids) || !args.ids.length) {
              return buildToolResult({
                status: 'needs_input',
                message:
                  'Parâmetro inválido: `ids` deve ser um array não vazio para reorder.',
                nextRequiredFields: ['ids'],
              });
            }
            if (args.ids.some((id: unknown) => typeof id !== 'string')) {
              return buildToolResult({
                status: 'needs_input',
                message:
                  'Parâmetro inválido: `ids` deve conter apenas strings.',
                nextRequiredFields: ['ids'],
              });
            }
            return buildToolResult({
              status: 'pending_confirmation',
              message: `A ordem das seções de laudo da solicitação ${auth.request.protocol} será atualizada com ${args.ids.length} itens. Confirme com "sim" para executar.`,
              pendingConfirmation: {
                tool: 'manage_report_sections',
                args: { ...args, confirm: true },
                description: 'reordenar seções do laudo',
              },
            });
          }
        }
      }

      try {
        switch (operation) {
          case 'create': {
            const title = asNonEmptyString(
              detokenizeArg(context, asScalarArg(args.title)),
            );
            if (!title) {
              return buildToolResult({
                status: 'needs_input',
                message:
                  'Parâmetro inválido: `title` é obrigatório para create.',
                nextRequiredFields: ['title'],
              });
            }

            const detokenizedDescription =
              args.description == null
                ? undefined
                : (detokenizeArg(context, asScalarArg(args.description)) ??
                  undefined);

            const section = await surgeryRequestsService.createReportSection(
              auth.request.id,
              { title, description: detokenizedDescription },
              context.userId as string,
            );

            await recordAiActivity(
              activityRepo,
              context,
              auth.request.id,
              `Seção de laudo criada (${section.id}).`,
            );

            return buildToolResult({
              status: 'ok',
              message: `✅ Seção criada com sucesso: ${section.title} (id: ${section.id}).`,
              affected: [{ kind: 'report_section', id: section.id }],
            });
          }
          case 'edit': {
            const sectionId = asNonEmptyString(args.section_id);
            if (!sectionId) {
              return buildToolResult({
                status: 'needs_input',
                message:
                  'Parâmetro inválido: `section_id` é obrigatório para edit.',
                nextRequiredFields: ['section_id'],
              });
            }

            if (args.title == null && args.description == null) {
              return buildToolResult({
                status: 'needs_input',
                message:
                  'Parâmetro inválido: informe `title` e/ou `description` para edit.',
                nextRequiredFields: ['title'],
              });
            }

            const updated = await surgeryRequestsService.updateReportSection(
              auth.request.id,
              sectionId,
              {
                title:
                  args.title == null
                    ? undefined
                    : (detokenizeArg(context, asScalarArg(args.title)) ??
                      undefined),
                description:
                  args.description == null
                    ? undefined
                    : (detokenizeArg(context, asScalarArg(args.description)) ??
                      undefined),
              },
              context.userId as string,
            );

            await recordAiActivity(
              activityRepo,
              context,
              auth.request.id,
              `Seção de laudo atualizada (${updated.id}).`,
            );

            return buildToolResult({
              status: 'ok',
              message: `✅ Seção atualizada com sucesso: ${updated.title} (id: ${updated.id}).`,
              affected: [{ kind: 'report_section', id: updated.id }],
            });
          }
          case 'delete': {
            const sectionId = asNonEmptyString(args.section_id);
            if (!sectionId) {
              return buildToolResult({
                status: 'needs_input',
                message:
                  'Parâmetro inválido: `section_id` é obrigatório para delete.',
                nextRequiredFields: ['section_id'],
              });
            }

            const result = await surgeryRequestsService.deleteReportSection(
              auth.request.id,
              sectionId,
              context.userId as string,
            );

            await recordAiActivity(
              activityRepo,
              context,
              auth.request.id,
              `Seção de laudo removida (${sectionId}).`,
            );

            return buildToolResult({
              status: 'ok',
              message: result.deleted
                ? `✅ Seção ${sectionId} removida com sucesso.`
                : `Nenhuma seção removida para id ${sectionId}.`,
              affected: result.deleted
                ? [{ kind: 'report_section', id: sectionId }]
                : undefined,
            });
          }
          case 'reorder': {
            if (!Array.isArray(args.ids) || !args.ids.length) {
              return buildToolResult({
                status: 'needs_input',
                message:
                  'Parâmetro inválido: `ids` deve ser um array não vazio para reorder.',
                nextRequiredFields: ['ids'],
              });
            }

            if (args.ids.some((id: unknown) => typeof id !== 'string')) {
              return buildToolResult({
                status: 'needs_input',
                message:
                  'Parâmetro inválido: `ids` deve conter apenas strings.',
                nextRequiredFields: ['ids'],
              });
            }

            const sections = await surgeryRequestsService.reorderReportSections(
              auth.request.id,
              { ids: args.ids },
              context.userId as string,
            );

            await recordAiActivity(
              activityRepo,
              context,
              auth.request.id,
              `Seções de laudo reordenadas (${args.ids.length} itens).`,
            );

            return buildToolResult({
              status: 'ok',
              message: `✅ Seções reordenadas com sucesso. Total de seções: ${sections.length}.`,
            });
          }
        }

        return buildToolResult({
          status: 'needs_input',
          message: 'Operação não suportada.',
        });
      } catch (err) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao gerenciar seções do laudo: ${errorMessage(err) || 'erro desconhecido'}`,
        });
      }
    },
  };
}
