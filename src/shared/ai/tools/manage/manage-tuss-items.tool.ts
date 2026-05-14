import OpenAI from 'openai';
import { AiTool, ToolContext } from '../tool.interface';
import { ActivityType } from '../../../../database/entities/surgery-request-activity.entity';
import { tokenizePii } from '../../pii/tool-pii-helpers';
import { translateServiceError } from '../helpers/service-error-translator';
import { buildToolResult } from '../tool-result';
import { ManageToolDeps } from './_types';
import {
  asNonEmptyString,
  asPositiveInt,
  ensurePendingForMutation,
  getAuthorizedRequest,
  resolveTussFromCatalog,
} from './_helpers';

export function buildManageTussItemsTool(deps: ManageToolDeps): AiTool {
  const {
    surgeryRequestRepo,
    surgeryRequestsService,
    activityRepo,
    tussItemRepo,
    tussService,
  } = deps;
  return {
    name: 'manage_tuss_items',
    definition: {
      type: 'function',
      function: {
        name: 'manage_tuss_items',
        description:
          'Gerencia itens TUSS de uma solicitação cirúrgica: list (consultar), add (adicionar), update (editar quantidade ou nome) e remove (excluir). Em `add` basta informar `tussCode` OU `name` — a tool consulta o catálogo (arquivo `tuss.json`) e completa o que faltar; se houver ambiguidade, devolve a lista para o usuário escolher. Mutações exigem confirm=true. Remoção só é permitida quando a SC está no status Pendente.',
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
            tussItemId: {
              type: 'string',
              description: 'ID do item TUSS (obrigatório em update e remove).',
            },
            tussCode: {
              type: 'string',
              description:
                'Código TUSS (com ou sem máscara). Em `add`: opcional se `name` foi informado — a tool busca no catálogo. Em `update`: opcional.',
            },
            name: {
              type: 'string',
              description:
                'Descrição do procedimento. Em `add`: opcional se `tussCode` foi informado — a tool busca no catálogo. Em `update`: opcional.',
            },
            quantity: {
              type: 'number',
              description: 'Quantidade do item (opcional em add e update).',
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
        'manage_tuss_items',
        'protocol',
        auth.request.protocol,
      );

      if (operation === 'list') {
        const items = await tussItemRepo.findMany({
          surgeryRequestId: auth.request.id,
        } as any);
        if (!items.length) {
          return buildToolResult({
            status: 'ok',
            message: `Nenhum item TUSS cadastrado para a solicitação SC-${protocolToken}.`,
            data: [],
          });
        }
        const lines = items.map(
          (item: any, index: number) =>
            `${index + 1}. ${item.tussCode} — ${item.name} (qtd: ${item.quantity})\n   id: ${item.id}`,
        );
        return buildToolResult({
          status: 'ok',
          message: [
            `Itens TUSS da solicitação SC-${protocolToken}:`,
            ...lines,
          ].join('\n'),
          data: items,
        });
      }

      if (operation === 'add') {
        const blockedAdd = ensurePendingForMutation(auth.request);
        if (blockedAdd) {
          return buildToolResult({ status: 'blocked', message: blockedAdd });
        }

        const rawCode = asNonEmptyString(args.tussCode);
        const rawName = asNonEmptyString(args.name);
        const quantity = asPositiveInt(args.quantity, 1);

        const resolved = resolveTussFromCatalog(tussService, rawCode, rawName);
        if (resolved.status !== 'ok') {
          return buildToolResult({
            status: 'needs_input',
            message: resolved.message,
            nextRequiredFields:
              resolved.status === 'missing' ? ['tussCode'] : undefined,
          });
        }

        const { tussCode, name } = resolved;

        if (!args.confirm) {
          const preview = `A solicitação SC-${protocolToken} receberá o item TUSS ${tussCode} (${name}), quantidade ${quantity}. Confirme com "sim" para executar.`;
          return buildToolResult({
            status: 'pending_confirmation',
            message: preview,
            pendingConfirmation: {
              tool: 'manage_tuss_items',
              args: { ...args, confirm: true },
              description: 'adicionar item TUSS',
            },
          });
        }

        let created: any;
        try {
          created = await surgeryRequestsService.addTussItem(
            auth.request.id,
            { tussCode, name, quantity },
            context.userId as string,
          );
        } catch (err) {
          return buildToolResult({
            status: 'error',
            message: translateServiceError(err),
          });
        }

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Item TUSS adicionado: ${tussCode} - ${name} (qtd: ${quantity}).`,
        });

        return buildToolResult({
          status: 'ok',
          message: `Item TUSS ${tussCode} (${name}) adicionado com sucesso (id: ${created.id}).`,
          affected: [{ kind: 'surgery_request_tuss_item', id: created.id }],
        });
      }

      const tussItemId = asNonEmptyString(args.tussItemId);
      if (!tussItemId) {
        return buildToolResult({
          status: 'needs_input',
          message: `Para ${operation}, informe \`tussItemId\`.`,
          nextRequiredFields: ['tussItemId'],
        });
      }

      const item = await tussItemRepo.findOne({
        id: tussItemId,
        surgeryRequestId: auth.request.id,
      } as any);
      if (!item) {
        return buildToolResult({
          status: 'blocked',
          message: 'Item TUSS não encontrado para essa solicitação.',
        });
      }

      if (operation === 'update') {
        const blockedUpdate = ensurePendingForMutation(auth.request);
        if (blockedUpdate) {
          return buildToolResult({
            status: 'blocked',
            message: blockedUpdate,
          });
        }

        const updates: Record<string, any> = {};
        const changes: string[] = [];

        const newCode = asNonEmptyString(args.tussCode);
        if (newCode && newCode !== item.tussCode) {
          updates.tussCode = newCode;
          changes.push(`código: ${newCode}`);
        }

        const newName = asNonEmptyString(args.name);
        if (newName && newName !== item.name) {
          updates.name = newName;
          changes.push(`nome: ${newName}`);
        }

        if (args.quantity !== undefined) {
          const q = asPositiveInt(args.quantity, item.quantity);
          if (q !== item.quantity) {
            updates.quantity = q;
            changes.push(`quantidade: ${q}`);
          }
        }

        if (!changes.length) {
          return buildToolResult({
            status: 'ok',
            message: 'Nenhuma alteração informada.',
          });
        }

        if (!args.confirm) {
          const preview = `O item TUSS ${item.tussCode} terá: ${changes.join(', ')}. Confirme com "sim" para executar.`;
          return buildToolResult({
            status: 'pending_confirmation',
            message: preview,
            pendingConfirmation: {
              tool: 'manage_tuss_items',
              args: { ...args, confirm: true },
              description: 'atualizar item TUSS',
            },
          });
        }

        try {
          await surgeryRequestsService.updateTussItem(
            tussItemId,
            updates,
            context.userId as string,
          );
        } catch (err) {
          return buildToolResult({
            status: 'error',
            message: translateServiceError(err),
          });
        }

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Item TUSS ${item.tussCode} atualizado (${changes.join(', ')}).`,
        });

        return buildToolResult({
          status: 'ok',
          message: `Item TUSS atualizado com sucesso.`,
          affected: [{ kind: 'surgery_request_tuss_item', id: tussItemId }],
        });
      }

      // operation === 'remove'
      const blocked = ensurePendingForMutation(auth.request);
      if (blocked) {
        return buildToolResult({ status: 'blocked', message: blocked });
      }

      if (!args.confirm) {
        const preview = `O item TUSS ${item.tussCode} (${item.name}) será removido da solicitação SC-${protocolToken}. Confirme com "sim" para executar.`;
        return buildToolResult({
          status: 'pending_confirmation',
          message: preview,
          pendingConfirmation: {
            tool: 'manage_tuss_items',
            args: { ...args, confirm: true },
            description: 'remover item TUSS',
          },
        });
      }

      try {
        await surgeryRequestsService.removeTussItem(
          tussItemId,
          context.userId as string,
        );
      } catch (err) {
        return buildToolResult({
          status: 'error',
          message: translateServiceError(err),
        });
      }

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Item TUSS removido: ${item.tussCode} (${item.name}).`,
      });

      return buildToolResult({
        status: 'ok',
        message: `Item TUSS ${item.tussCode} removido com sucesso.`,
        affected: [{ kind: 'surgery_request_tuss_item', id: tussItemId }],
      });
    },
  };
}
