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
  classifyDocumentType,
  downloadInboundMedia,
  getAuthorizedRequest,
  REPORT_IMAGE_KEY,
  sanitizeAlphaNumKey,
} from './_helpers';

export function buildManageDocumentsTool(deps: ManageToolDeps): AiTool {
  const {
    surgeryRequestRepo,
    activityRepo,
    documentRepo,
    storageService,
    configService,
    documentsService,
  } = deps;
  return {
    name: 'manage_documents',
    definition: {
      type: 'function',
      function: {
        name: 'manage_documents',
        description:
          'Gerencia documentos da solicitação cirúrgica: list (lista os documentos anexados, exceto imagens do laudo), attach (anexa o arquivo recebido pelo WhatsApp como documento) e remove (exclui). Mutações exigem confirm=true.',
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
            documentId: {
              type: 'string',
              description: 'ID do documento (obrigatório em remove).',
            },
            documentType: {
              type: 'string',
              description:
                'Tipo do documento (opcional em attach; ex.: medical_report, exam_report, surgery_room).',
            },
            documentName: {
              type: 'string',
              description: 'Nome amigável do documento (opcional em attach).',
            },
            documentKey: {
              type: 'string',
              description:
                'Chave técnica do documento (opcional em attach; gerada automaticamente se omitida).',
            },
            mediaIndex: {
              type: 'number',
              description:
                'Índice da mídia recebida no WhatsApp quando há mais de uma (opcional em attach; padrão 0).',
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
        'manage_documents',
        'protocol',
        auth.request.protocol,
      );

      if (operation === 'list') {
        const docs = await documentRepo.findMany({
          surgeryRequestId: auth.request.id,
        } as any);
        const filtered = docs.filter((d: any) => d.key !== REPORT_IMAGE_KEY);
        if (!filtered.length) {
          return buildToolResult({
            status: 'ok',
            message: `Nenhum documento anexado à solicitação SC-${protocolToken}.`,
            data: [],
          });
        }
        const lines = filtered.map((d: any, index: number) => {
          const date = d.createdAt
            ? new Date(d.createdAt).toLocaleDateString('pt-BR')
            : '';
          return `${index + 1}. ${d.name || d.key} (tipo: ${d.type || 'n/d'}${date ? `, ${date}` : ''})\n   id: ${d.id}`;
        });
        return buildToolResult({
          status: 'ok',
          message: [
            `Documentos da solicitação SC-${protocolToken}:`,
            ...lines,
          ].join('\n'),
          data: filtered,
        });
      }

      if (operation === 'attach') {
        const inboundMedia = context.inboundMedia || [];
        if (!inboundMedia.length) {
          return buildToolResult({
            status: 'blocked',
            message:
              'Não identifiquei nenhum arquivo nesta mensagem. Envie o documento pelo WhatsApp e tente novamente.',
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
        const detectedType = classifyDocumentType(
          media.contentType,
          args.documentType,
        );
        const providedName = asNonEmptyString(args.documentName);
        const computedKey =
          asNonEmptyString(args.documentKey) ||
          sanitizeAlphaNumKey(
            detectedType || providedName || 'documento_whatsapp',
          );
        const computedName =
          providedName ||
          `Documento WhatsApp ${new Date().toLocaleDateString('pt-BR')}`;

        if (!args.confirm) {
          const preview = `Documento identificado para a solicitação SC-${protocolToken}. Tipo: ${detectedType}. Nome: ${computedName}. Confirme com "sim" para anexar.`;
          return buildToolResult({
            status: 'pending_confirmation',
            message: preview,
            pendingConfirmation: {
              tool: 'manage_documents',
              args: { ...args, confirm: true },
              description: 'anexar documento',
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
                media.contentType ||
                downloaded.contentType ||
                'application/octet-stream',
              buffer: downloaded.buffer,
            } as any,
            STORAGE_FOLDERS.DOCUMENTS,
          );

          let created: any;
          try {
            created = await documentsService.createFromPath({
              surgeryRequestId: auth.request.id,
              storagePath: path,
              type: detectedType,
              name: computedName,
              key: computedKey,
              contentType:
                media.contentType ||
                downloaded.contentType ||
                'application/octet-stream',
              createdById: context.userId as string,
            });
          } catch (err) {
            return buildToolResult({
              status: 'error',
              message: `Erro ao anexar documento: ${translateServiceError(err)}`,
            });
          }

          await activityRepo.create({
            surgeryRequestId: auth.request.id,
            userId: context.userId as string,
            type: ActivityType.SYSTEM,
            content: `[WhatsApp IA] Documento anexado: ${computedName} (tipo: ${detectedType}).`,
          });

          return buildToolResult({
            status: 'ok',
            message: `Documento ${computedName} anexado com sucesso (id: ${(created as any).id}).`,
            affected: [{ kind: 'document', id: (created as any).id }],
          });
        } catch (err: any) {
          return buildToolResult({
            status: 'error',
            message: `Erro ao anexar documento: ${err?.message || 'erro desconhecido'}`,
          });
        }
      }

      // operation === 'remove'
      const documentId = asNonEmptyString(args.documentId);
      if (!documentId) {
        return buildToolResult({
          status: 'needs_input',
          message: 'Para remover, informe `documentId`.',
          nextRequiredFields: ['documentId'],
        });
      }

      const doc = await documentRepo.findOne({
        id: documentId,
        surgeryRequestId: auth.request.id,
      } as any);
      if (!doc) {
        return buildToolResult({
          status: 'blocked',
          message: 'Documento não encontrado para essa solicitação.',
        });
      }

      if (doc.key === REPORT_IMAGE_KEY) {
        return buildToolResult({
          status: 'blocked',
          message:
            'Esse arquivo é uma imagem do laudo — use `manage_report_images` para removê-la.',
        });
      }

      if (!args.confirm) {
        const preview = `O documento "${doc.name}" será removido da solicitação SC-${protocolToken}. Confirme com "sim" para executar.`;
        return buildToolResult({
          status: 'pending_confirmation',
          message: preview,
          pendingConfirmation: {
            tool: 'manage_documents',
            args: { ...args, confirm: true },
            description: 'remover documento',
          },
        });
      }

      await documentsService.delete({
        id: documentId,
        key: doc.key,
        surgeryRequestId: auth.request.id,
      });

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Documento removido: ${doc.name} (tipo: ${doc.type}).`,
      });

      return buildToolResult({
        status: 'ok',
        message: `Documento "${doc.name}" removido com sucesso.`,
        affected: [{ kind: 'document', id: documentId }],
      });
    },
  };
}
