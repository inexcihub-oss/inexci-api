import OpenAI from 'openai';
import { AiTool, ToolContext } from '../tool.interface';
import { ActivityType } from '../../../../database/entities/surgery-request-activity.entity';
import { tokenizePii } from '../../pii/tool-pii-helpers';
import { translateServiceError } from '../helpers/service-error-translator';
import { STORAGE_FOLDERS } from '../../../../config/storage.config';
import { buildToolResult } from '../tool-result';
import { ManageToolDeps } from './_types';
import {
  asNonEmptyString,
  downloadInboundMedia,
  ensurePendingForMutation,
  getAuthorizedRequest,
  REPORT_IMAGE_KEY,
  REPORT_IMAGE_TYPE,
} from './_helpers';

export function buildManageReportImagesTool(deps: ManageToolDeps): AiTool {
  const {
    surgeryRequestRepo,
    activityRepo,
    documentRepo,
    storageService,
    configService,
    documentsService,
  } = deps;
  return {
    name: 'manage_report_images',
    definition: {
      type: 'function',
      function: {
        name: 'manage_report_images',
        description:
          'Gerencia as imagens anexadas ao laudo de uma solicitação cirúrgica: list (consultar), attach (anexa a imagem recebida pelo WhatsApp como imagem do laudo) e remove (excluir). Apenas arquivos do tipo imagem podem ser anexados. Mutações exigem confirm=true.',
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
              description: 'Operação: list, attach ou remove.',
            },
            imageId: {
              type: 'string',
              description: 'ID da imagem (obrigatório em remove).',
            },
            mediaIndex: {
              type: 'number',
              description:
                'Índice da mídia recebida no WhatsApp quando há mais de uma (opcional em attach; padrão 0).',
            },
            imageName: {
              type: 'string',
              description: 'Nome amigável da imagem (opcional em attach).',
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
      if (!operation || !['list', 'attach', 'remove'].includes(operation)) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Parâmetro inválido: `operation` deve ser list, attach ou remove.',
          nextRequiredFields: ['operation'],
        });
      }

      const protocolToken = tokenizePii(
        context,
        'manage_report_images',
        'protocol',
        auth.request.protocol,
      );

      if (operation === 'list') {
        const all = await documentRepo.findMany({
          surgeryRequestId: auth.request.id,
        } as any);
        const images = all.filter((d: any) => d.key === REPORT_IMAGE_KEY);
        if (!images.length) {
          return buildToolResult({
            status: 'ok',
            message: `Nenhuma imagem anexada ao laudo da solicitação SC-${protocolToken}.`,
            data: [],
          });
        }
        const lines = images.map((d: any, index: number) => {
          const date = d.createdAt
            ? new Date(d.createdAt).toLocaleDateString('pt-BR')
            : '';
          return `${index + 1}. ${d.name || 'Imagem'}${date ? ` (${date})` : ''}\n   id: ${d.id}`;
        });
        return buildToolResult({
          status: 'ok',
          message: [
            `Imagens do laudo da solicitação SC-${protocolToken}:`,
            ...lines,
          ].join('\n'),
          data: images,
        });
      }

      if (operation === 'attach') {
        const blockedAttach = ensurePendingForMutation(auth.request);
        if (blockedAttach) {
          return buildToolResult({
            status: 'blocked',
            message: blockedAttach,
          });
        }

        const inboundMedia = context.inboundMedia || [];
        if (!inboundMedia.length) {
          return buildToolResult({
            status: 'blocked',
            message:
              'Não identifiquei nenhuma imagem nesta mensagem. Envie a imagem pelo WhatsApp e tente novamente.',
          });
        }

        const mediaIndex =
          typeof args.mediaIndex === 'number' &&
          Number.isInteger(args.mediaIndex) &&
          args.mediaIndex >= 0 &&
          args.mediaIndex < inboundMedia.length
            ? args.mediaIndex
            : 0;

        const media = inboundMedia[mediaIndex];
        const mime = (media.contentType || '').toLowerCase();
        if (!mime.startsWith('image/')) {
          return buildToolResult({
            status: 'blocked',
            message:
              'O arquivo enviado não é uma imagem. Envie uma foto/imagem (JPG, PNG, etc.) para anexar ao laudo.',
          });
        }

        const providedName = asNonEmptyString(args.imageName);
        const computedName =
          providedName ||
          `Imagem do laudo ${new Date().toLocaleDateString('pt-BR')}`;

        if (!args.confirm) {
          const preview = `A imagem "${computedName}" será anexada ao laudo da solicitação SC-${protocolToken}. Confirme com "sim" para executar.`;
          return buildToolResult({
            status: 'pending_confirmation',
            message: preview,
            pendingConfirmation: {
              tool: 'manage_report_images',
              args: { ...args, confirm: true },
              description: 'anexar imagem ao laudo',
            },
          });
        }

        try {
          const downloaded = await downloadInboundMedia(
            media.url,
            configService,
          );
          const path = await storageService.create(
            {
              originalname: computedName,
              mimetype:
                media.contentType || downloaded.contentType || 'image/jpeg',
              buffer: downloaded.buffer,
            } as any,
            STORAGE_FOLDERS.DOCUMENTS,
          );

          let created: any;
          try {
            created = await documentsService.createFromPath({
              surgeryRequestId: auth.request.id,
              storagePath: path,
              type: REPORT_IMAGE_TYPE,
              name: computedName,
              key: REPORT_IMAGE_KEY,
              contentType:
                media.contentType || downloaded.contentType || 'image/jpeg',
              createdById: context.userId as string,
            });
          } catch (err) {
            return buildToolResult({
              status: 'error',
              message: `Erro ao anexar imagem: ${translateServiceError(err)}`,
            });
          }

          await activityRepo.create({
            surgeryRequestId: auth.request.id,
            userId: context.userId as string,
            type: ActivityType.SYSTEM,
            content: `[WhatsApp IA] Imagem anexada ao laudo: ${computedName}.`,
          });

          return buildToolResult({
            status: 'ok',
            message: `Imagem "${computedName}" anexada ao laudo com sucesso (id: ${(created as any).id}).`,
            affected: [{ kind: 'document', id: (created as any).id }],
          });
        } catch (err: any) {
          return buildToolResult({
            status: 'error',
            message: `Erro ao anexar imagem: ${err?.message || 'erro desconhecido'}`,
          });
        }
      }

      // operation === 'remove'
      const blockedRemove = ensurePendingForMutation(auth.request);
      if (blockedRemove) {
        return buildToolResult({ status: 'blocked', message: blockedRemove });
      }

      const imageId = asNonEmptyString(args.imageId);
      if (!imageId) {
        return buildToolResult({
          status: 'needs_input',
          message: 'Para remover, informe `imageId`.',
          nextRequiredFields: ['imageId'],
        });
      }

      const doc = await documentRepo.findOne({
        id: imageId,
        surgeryRequestId: auth.request.id,
      } as any);
      if (!doc || doc.key !== REPORT_IMAGE_KEY) {
        return buildToolResult({
          status: 'blocked',
          message: 'Imagem do laudo não encontrada para essa solicitação.',
        });
      }

      if (!args.confirm) {
        const preview = `A imagem "${doc.name}" será removida do laudo da solicitação SC-${protocolToken}. Confirme com "sim" para executar.`;
        return buildToolResult({
          status: 'pending_confirmation',
          message: preview,
          pendingConfirmation: {
            tool: 'manage_report_images',
            args: { ...args, confirm: true },
            description: 'remover imagem do laudo',
          },
        });
      }

      await documentsService.delete({
        id: imageId,
        key: REPORT_IMAGE_KEY,
        surgeryRequestId: auth.request.id,
      });

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Imagem removida do laudo: ${doc.name}.`,
      });

      return buildToolResult({
        status: 'ok',
        message: `Imagem "${doc.name}" removida do laudo com sucesso.`,
        affected: [{ kind: 'document', id: imageId }],
      });
    },
  };
}
