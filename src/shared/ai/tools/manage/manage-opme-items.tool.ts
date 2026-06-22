import OpenAI from 'openai';
import { AiTool, ToolContext } from '../tool.interface';
import { ActivityType } from '../../../../database/entities/surgery-request-activity.entity';
import { tokenizePii } from '../../pii/tool-pii-helpers';
import { translateServiceError } from '../helpers/service-error-translator';
import { ManageToolDeps } from './_types';
import {
  asNonEmptyString,
  asPositiveInt,
  ensurePendingForMutation,
  getAuthorizedRequest,
  parseStringList,
} from './_helpers';

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
      if (!auth.ok) return auth.message;

      const operation = asNonEmptyString(args.operation)?.toLowerCase();
      if (
        !operation ||
        !['list', 'add', 'update', 'remove'].includes(operation)
      ) {
        return 'Parâmetro inválido: `operation` deve ser list, add, update ou remove.';
      }

      const protocolToken = tokenizePii(
        context,
        'manage_opme_items',
        'protocol',
        auth.request.protocol,
      );

      if (operation === 'list') {
        const items = await opmeItemRepo.getRepository().find({
          where: { surgeryRequestId: auth.request.id } as any,
          relations: ['suppliers', 'manufacturers'],
        });

        if (!items.length) {
          return `Nenhum item OPME cadastrado para a solicitação SC-${protocolToken}.`;
        }

        const lines = items.map((item: any, index: number) => {
          const suppliers = (item.suppliers || [])
            .map((s: any) => s.name)
            .filter(Boolean)
            .join(', ');
          const manufacturers = (item.manufacturers || [])
            .map((m: any) => m.name)
            .filter(Boolean)
            .join(', ');
          return [
            `${index + 1}. ${item.name} (qtd: ${item.quantity})`,
            `   Fabricantes: ${manufacturers || 'não informado'}`,
            `   Fornecedores: ${suppliers || 'não informados'}`,
            `   id: ${item.id}`,
          ].join('\n');
        });

        return [
          `Itens OPME da solicitação SC-${protocolToken}:`,
          ...lines,
        ].join('\n');
      }

      if (operation === 'add') {
        const blockedAdd = ensurePendingForMutation(auth.request);
        if (blockedAdd) return blockedAdd;

        const name = asNonEmptyString(args.name);
        const manufacturerNames = parseStringList(args.manufacturerNames);
        const supplierNames = parseStringList(args.supplierNames);
        const quantity = asPositiveInt(args.quantity, 1);

        if (!name) {
          return 'Para adicionar OPME, informe `name`.';
        }
        if (manufacturerNames.length < 3) {
          return 'Para adicionar OPME, informe ao menos 3 fabricantes em `manufacturerNames`.';
        }
        if (supplierNames.length < 3) {
          return 'Para adicionar OPME, informe ao menos 3 fornecedores em `supplierNames`.';
        }

        if (!args.confirm) {
          return `A solicitação SC-${protocolToken} receberá item OPME ${name}, quantidade ${quantity}, com ${manufacturerNames.length} fabricantes e ${supplierNames.length} fornecedores. Confirme com "sim" para executar.`;
        }

        let saved: any;
        try {
          saved = await opmeService!.create(
            {
              surgeryRequestId: auth.request.id,
              name,
              manufacturerNames,
              quantity,
              supplierNames,
            },
            context.userId as string,
          );
        } catch (err) {
          return `Erro ao adicionar item OPME: ${translateServiceError(err)}`;
        }

        await surgeryRequestsService.setHasOpme(
          auth.request.id,
          true,
          context.userId as string,
        );

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Item OPME adicionado: ${name}, qtd ${quantity}, ${manufacturerNames.length} fabricantes, ${supplierNames.length} fornecedores.`,
        });

        return `Item OPME ${name} adicionado com sucesso (id: ${saved.id}).`;
      }

      const opmeItemId = asNonEmptyString(args.opmeItemId);
      if (!opmeItemId) {
        return `Para ${operation}, informe \`opmeItemId\`.`;
      }

      const item = await opmeItemRepo.findByIdWithSuppliers(opmeItemId);
      if (!item || item.surgeryRequestId !== auth.request.id) {
        return 'Item OPME não encontrado para essa solicitação.';
      }

      if (operation === 'update') {
        const blockedUpdate = ensurePendingForMutation(auth.request);
        if (blockedUpdate) return blockedUpdate;

        const changes: string[] = [];

        const newName = asNonEmptyString(args.name);
        if (newName && newName !== item.name) {
          item.name = newName;
          changes.push(`nome: ${newName}`);
        }

        if (args.quantity !== undefined) {
          const q = asPositiveInt(args.quantity, item.quantity);
          if (q !== item.quantity) {
            item.quantity = q;
            changes.push(`quantidade: ${q}`);
          }
        }

        if (args.manufacturerNames !== undefined) {
          const manufacturers = parseStringList(args.manufacturerNames);
          if (manufacturers.length < 3) {
            return 'Para atualizar fabricantes, informe ao menos 3 em `manufacturerNames`.';
          }
          changes.push(`fabricantes: ${manufacturers.length} itens`);
        }

        if (args.supplierNames !== undefined) {
          const supplierNames = parseStringList(args.supplierNames);
          if (supplierNames.length < 3) {
            return 'Para atualizar fornecedores, informe ao menos 3 em `supplierNames`.';
          }
          changes.push(`fornecedores: ${supplierNames.length} itens`);
        }

        if (!changes.length) {
          return 'Nenhuma alteração informada.';
        }

        if (!args.confirm) {
          return `O item OPME ${item.name} terá: ${changes.join(', ')}. Confirme com "sim" para executar.`;
        }

        const updateDto: any = { id: opmeItemId };
        if (newName && newName !== item.name) updateDto.name = newName;
        if (args.quantity !== undefined) {
          const q = asPositiveInt(args.quantity, item.quantity);
          if (q !== item.quantity) updateDto.quantity = q;
        }
        if (args.manufacturerNames !== undefined) {
          updateDto.manufacturerNames = parseStringList(args.manufacturerNames);
        }
        if (args.supplierNames !== undefined) {
          updateDto.supplierNames = parseStringList(args.supplierNames);
        }

        try {
          await opmeService!.update(updateDto, context.userId as string);
        } catch (err) {
          return `Erro ao atualizar item OPME: ${translateServiceError(err)}`;
        }

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Item OPME ${item.name} atualizado (${changes.join(', ')}).`,
        });

        return `Item OPME atualizado com sucesso.`;
      }

      const blocked = ensurePendingForMutation(auth.request);
      if (blocked) return blocked;

      if (!args.confirm) {
        return `O item OPME ${item.name} será removido da solicitação SC-${protocolToken}. Confirme com "sim" para executar.`;
      }

      const removedName = item.name;
      try {
        await opmeService!.delete(opmeItemId, context.userId as string);
      } catch (err) {
        return `Erro ao remover item OPME: ${translateServiceError(err)}`;
      }

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Item OPME removido: ${removedName}.`,
      });

      return `Item OPME ${removedName} removido com sucesso.`;
    },
  };
}
