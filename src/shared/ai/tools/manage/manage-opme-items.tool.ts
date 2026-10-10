import OpenAI from 'openai';
import { AiTool, ToolContext } from '../tool.interface';
import { Permission } from 'src/shared/permissions';
import { tokenizePii } from '../../pii/tool-pii-helpers';
import { translateServiceError } from '../helpers/service-error-translator';
import { ManageToolDeps } from './_types';
import { buildToolResult } from '../tool-result';
import { UpdateOpmeDto } from '../../../../modules/surgery-requests/opme/dto/update-opme.dto';
import {
  asNonEmptyString,
  asPositiveInt,
  parseStringList,
} from '../helpers/arg-parsers';
import {
  ensurePendingForMutation,
  getAuthorizedRequest,
  recordAiActivity,
} from '../helpers/surgery-request-access';

export function buildManageOpmeItemsTool(deps: ManageToolDeps): AiTool {
  const {
    surgeryRequestRepo,
    surgeryRequestsService,
    activityRepo,
    opmeItemRepo,
    opmeService,
  } = deps;
  return {
    name: 'manage_opme_items',
    requiredPermission: Permission.SOLICITACOES,
    mutates: true,
    definition: {
      type: 'function',
      function: {
        name: 'manage_opme_items',
        description:
          'Gerencia itens OPME de uma solicitação cirúrgica: list (consultar), add (adicionar — exige ao menos 3 fabricantes e 3 fornecedores), update (editar nome, quantidade, fabricantes e fornecedores) e remove (excluir). Mutações exigem confirm=true. Remoção só é permitida quando a SC está no status Pendente.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description:
                'ID/Protocolo da solicitação (UUID, SC-XXXX ou número).',
            },
            operation: {
              type: 'string',
              description: 'Operação: list, add, update ou remove.',
            },
            opmeItemId: {
              type: 'string',
              description: 'ID do item OPME (obrigatório em update e remove).',
            },
            name: {
              type: 'string',
              description: 'Nome do item OPME (obrigatório em add).',
            },
            quantity: {
              type: 'number',
              description: 'Quantidade (opcional em add e update).',
            },
            manufacturerNames: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Lista com ao menos 3 fabricantes (obrigatório em add; opcional em update).',
            },
            supplierNames: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Lista com ao menos 3 fornecedores (obrigatório em add; opcional em update).',
            },
            confirm: {
              type: 'boolean',
              description:
                'Obrigatório (true) para executar mutações; em list é ignorado.',
            },
          },
          required: ['surgeryRequestId', 'operation'],
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
      const requestId = auth.request.id;
      const userId = context.userId as string;

      const operation = asNonEmptyString(args.operation)?.toLowerCase();
      if (
        !operation ||
        !['list', 'add', 'update', 'remove'].includes(operation)
      ) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Parâmetro inválido: `operation` deve ser list, add, update ou remove.',
          nextRequiredFields: ['operation'],
        });
      }

      const protocolToken = tokenizePii(
        context,
        'manage_opme_items',
        'protocol',
        auth.request.protocol,
      );

      if (operation === 'list') {
        const items = await opmeItemRepo.getRepository().find({
          where: { surgeryRequestId: requestId },
          relations: ['suppliers', 'manufacturers'],
        });

        if (!items.length) {
          return buildToolResult({
            status: 'ok',
            message: `Nenhum item OPME cadastrado para a solicitação SC-${protocolToken}.`,
            data: [],
          });
        }

        const lines = items.map((item, index) => {
          const suppliers = (item.suppliers || [])
            .map((s) => s.name)
            .filter(Boolean)
            .join(', ');
          const manufacturers = (item.manufacturers || [])
            .map((m) => m.name)
            .filter(Boolean)
            .join(', ');
          return [
            `${index + 1}. ${item.name} (qtd: ${item.quantity})`,
            `   Fabricantes: ${manufacturers || 'não informado'}`,
            `   Fornecedores: ${suppliers || 'não informados'}`,
            `   id: ${item.id}`,
          ].join('\n');
        });

        return buildToolResult({
          status: 'ok',
          message: [
            `Itens OPME da solicitação SC-${protocolToken}:`,
            ...lines,
          ].join('\n'),
        });
      }

      const blocked = ensurePendingForMutation(auth.request);
      if (blocked) {
        return buildToolResult({ status: 'blocked', message: blocked });
      }

      const pendingConfirmation = (message: string, description: string) =>
        buildToolResult({
          status: 'pending_confirmation',
          message,
          pendingConfirmation: {
            tool: 'manage_opme_items',
            args: { ...args, confirm: true },
            description,
          },
        });

      if (operation === 'add') {
        const name = asNonEmptyString(args.name);
        const manufacturerNames = parseStringList(args.manufacturerNames);
        const supplierNames = parseStringList(args.supplierNames);
        const quantity = asPositiveInt(args.quantity, 1);

        if (!name) {
          return buildToolResult({
            status: 'needs_input',
            message: 'Para adicionar OPME, informe `name`.',
            nextRequiredFields: ['name'],
          });
        }
        if (manufacturerNames.length < 3) {
          return buildToolResult({
            status: 'needs_input',
            message:
              'Para adicionar OPME, informe ao menos 3 fabricantes em `manufacturerNames`.',
            nextRequiredFields: ['manufacturerNames'],
          });
        }
        if (supplierNames.length < 3) {
          return buildToolResult({
            status: 'needs_input',
            message:
              'Para adicionar OPME, informe ao menos 3 fornecedores em `supplierNames`.',
            nextRequiredFields: ['supplierNames'],
          });
        }

        if (!args.confirm) {
          return pendingConfirmation(
            `A solicitação SC-${protocolToken} receberá item OPME ${name}, quantidade ${quantity}, com ${manufacturerNames.length} fabricantes e ${supplierNames.length} fornecedores. Confirme com "sim" para executar.`,
            'adicionar item OPME',
          );
        }

        let savedId: string;
        try {
          const saved = await opmeService.create(
            {
              surgeryRequestId: requestId,
              name,
              manufacturerNames,
              quantity,
              supplierNames,
            },
            userId,
          );
          savedId = saved.id;
        } catch (err) {
          return buildToolResult({
            status: 'error',
            message: `Erro ao adicionar item OPME: ${translateServiceError(err)}`,
          });
        }

        await surgeryRequestsService.setHasOpme(requestId, true, userId);
        await recordAiActivity(
          activityRepo,
          context,
          requestId,
          `Item OPME adicionado: ${name}, qtd ${quantity}, ${manufacturerNames.length} fabricantes, ${supplierNames.length} fornecedores.`,
        );

        return buildToolResult({
          status: 'ok',
          message: `Item OPME ${name} adicionado com sucesso (id: ${savedId}).`,
          affected: [{ kind: 'opme_item', id: savedId }],
        });
      }

      const opmeItemId = asNonEmptyString(args.opmeItemId);
      if (!opmeItemId) {
        return buildToolResult({
          status: 'needs_input',
          message: `Para ${operation}, informe \`opmeItemId\`.`,
          nextRequiredFields: ['opmeItemId'],
        });
      }

      const item = await opmeItemRepo.findByIdWithSuppliers(opmeItemId);
      if (!item || item.surgeryRequestId !== requestId) {
        return buildToolResult({
          status: 'blocked',
          message: 'Item OPME não encontrado para essa solicitação.',
        });
      }

      if (operation === 'update') {
        const updateDto: UpdateOpmeDto = { id: opmeItemId };
        const changes: string[] = [];

        const newName = asNonEmptyString(args.name);
        if (newName && newName !== item.name) {
          updateDto.name = newName;
          changes.push(`nome: ${newName}`);
        }

        if (args.quantity !== undefined) {
          const q = asPositiveInt(args.quantity, item.quantity);
          if (q !== item.quantity) {
            updateDto.quantity = q;
            changes.push(`quantidade: ${q}`);
          }
        }

        if (args.manufacturerNames !== undefined) {
          const manufacturers = parseStringList(args.manufacturerNames);
          if (manufacturers.length < 3) {
            return buildToolResult({
              status: 'needs_input',
              message:
                'Para atualizar fabricantes, informe ao menos 3 em `manufacturerNames`.',
              nextRequiredFields: ['manufacturerNames'],
            });
          }
          updateDto.manufacturerNames = manufacturers;
          changes.push(`fabricantes: ${manufacturers.length} itens`);
        }

        if (args.supplierNames !== undefined) {
          const suppliers = parseStringList(args.supplierNames);
          if (suppliers.length < 3) {
            return buildToolResult({
              status: 'needs_input',
              message:
                'Para atualizar fornecedores, informe ao menos 3 em `supplierNames`.',
              nextRequiredFields: ['supplierNames'],
            });
          }
          updateDto.supplierNames = suppliers;
          changes.push(`fornecedores: ${suppliers.length} itens`);
        }

        if (!changes.length) {
          return buildToolResult({
            status: 'needs_input',
            message: 'Nenhuma alteração informada.',
          });
        }

        if (!args.confirm) {
          return pendingConfirmation(
            `O item OPME ${item.name} terá: ${changes.join(', ')}. Confirme com "sim" para executar.`,
            'atualizar item OPME',
          );
        }

        try {
          await opmeService.update(updateDto, userId);
        } catch (err) {
          return buildToolResult({
            status: 'error',
            message: `Erro ao atualizar item OPME: ${translateServiceError(err)}`,
          });
        }

        await recordAiActivity(
          activityRepo,
          context,
          requestId,
          `Item OPME ${item.name} atualizado (${changes.join(', ')}).`,
        );

        return buildToolResult({
          status: 'ok',
          message: 'Item OPME atualizado com sucesso.',
          affected: [{ kind: 'opme_item', id: opmeItemId }],
        });
      }

      if (!args.confirm) {
        return pendingConfirmation(
          `O item OPME ${item.name} será removido da solicitação SC-${protocolToken}. Confirme com "sim" para executar.`,
          'remover item OPME',
        );
      }

      const removedName = item.name;
      try {
        await opmeService.delete(opmeItemId, userId);
      } catch (err) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao remover item OPME: ${translateServiceError(err)}`,
        });
      }

      await recordAiActivity(
        activityRepo,
        context,
        requestId,
        `Item OPME removido: ${removedName}.`,
      );

      return buildToolResult({
        status: 'ok',
        message: `Item OPME ${removedName} removido com sucesso.`,
        affected: [{ kind: 'opme_item', id: opmeItemId }],
      });
    },
  };
}
