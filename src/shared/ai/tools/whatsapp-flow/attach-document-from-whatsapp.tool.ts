import OpenAI from 'openai';
import { AiTool } from '../tool.interface';
import { ActivityType } from '../../../../database/entities/surgery-request-activity.entity';
import { tokenizePii } from '../../pii/tool-pii-helpers';
import { STORAGE_FOLDERS } from '../../../../config/storage.config';
import { translateServiceError } from '../helpers/service-error-translator';
import { buildToolResult } from '../tool-result';
import { WhatsappFlowToolDeps } from './_types';
import {
  asNonEmptyString,
  documentTypeKeyToLabel,
  getAuthorizedRequest,
  SUPPORTED_ATTACH_DOCUMENT_TYPES,
} from './_helpers';

export function buildAttachDocumentFromWhatsappTool(
  deps: WhatsappFlowToolDeps,
): AiTool {
  const { surgeryRequestRepo, activityRepo, documentDeps } = deps;
  return {
    name: 'attach_document_from_whatsapp',
    definition: {
      type: 'function',
      function: {
        name: 'attach_document_from_whatsapp',
        description:
          'Anexa o documento que o usuário acabou de enviar pelo WhatsApp (imagem ou PDF) a uma solicitação cirúrgica. O arquivo já está no staging — aqui o sistema move para o storage definitivo, cria o registro `documents` e limpa a pendência. Requer `confirm=true` para executar.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description:
                'ID ou protocolo (ex.: SC-1234) da solicitação cirúrgica destino.',
            },
            documentType: {
              type: 'string',
              description:
                'Tipo do documento. Valores aceitos: personal_document, exam_report, medical_report, authorization_guide, surgery_room, surgery_images, surgery_auth_document, invoice_protocol, receipt_document, contest_file, additional_document. Use o `suggestedDocumentType` quando disponível.',
            },
            documentName: {
              type: 'string',
              description:
                'Nome amigável para o documento (opcional). Se omitido, usa o nome do arquivo original.',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a ação. Se false ou omitido, mostra preview.',
            },
          },
          required: ['surgeryRequestId', 'documentType'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const {
        documentDispatcher,
        storageService,
        documentsService,
      } = documentDeps;
      if (!documentDispatcher || !storageService) {
        return buildToolResult({
          status: 'blocked',
          message:
            'Anexar documentos via WhatsApp ainda está sendo finalizado pela equipe.',
        });
      }
      if (!context.userId || !context.phone) {
        return buildToolResult({
          status: 'blocked',
          message: 'Acesso negado.',
        });
      }

      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) {
        return buildToolResult({ status: 'blocked', message: auth.message });
      }

      const documentType = asNonEmptyString(args.documentType);
      if (
        !documentType ||
        !SUPPORTED_ATTACH_DOCUMENT_TYPES.includes(documentType)
      ) {
        return buildToolResult({
          status: 'needs_input',
          message: `Parâmetro inválido: \`documentType\` deve ser um destes: ${SUPPORTED_ATTACH_DOCUMENT_TYPES.join(', ')}.`,
          nextRequiredFields: ['documentType'],
        });
      }

      const pending = await documentDispatcher.getPending(context.phone);
      if (!pending) {
        return buildToolResult({
          status: 'blocked',
          message:
            'Não encontrei nenhum documento pendente recente. Reenvie o arquivo pelo WhatsApp e tente novamente.',
        });
      }

      const documentName =
        asNonEmptyString(args.documentName) ||
        pending.fileName ||
        documentTypeKeyToLabel(documentType);
      const protocolToken = tokenizePii(
        context,
        'attach_document_from_whatsapp',
        'protocol',
        auth.request.protocol,
      );

      if (!args.confirm) {
        const preview = [
          'Pré-visualização do anexo:',
          `• Solicitação: ${protocolToken}`,
          `• Tipo: ${documentTypeKeyToLabel(documentType)}`,
          `• Arquivo: ${documentName}`,
          `• Origem: WhatsApp (${pending.kind === 'pdf' ? 'PDF' : 'imagem'} • ${(pending.sizeBytes / 1024).toFixed(1)} KB)`,
          'Confirme com "sim" para anexar.',
        ].join('\n');
        return buildToolResult({
          status: 'pending_confirmation',
          message: preview,
          pendingConfirmation: {
            tool: 'attach_document_from_whatsapp',
            args: { ...args, confirm: true },
            description: 'anexar documento via WhatsApp',
          },
        });
      }

      let finalPath: string;
      try {
        finalPath = await storageService.move(
          pending.storagePath,
          STORAGE_FOLDERS.DOCUMENTS,
        );
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao mover o arquivo para o storage definitivo: ${err?.message || 'erro desconhecido'}.`,
        });
      }

      let document: any;
      try {
        document = await documentsService.createFromPath({
          surgeryRequestId: auth.request.id,
          createdById: context.userId as string,
          type: documentType,
          key: documentType,
          name: documentName,
          storagePath: finalPath,
          contentType: pending.contentType,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Anexei o arquivo, mas não consegui registrá-lo no histórico: ${translateServiceError(err)}.`,
        });
      }

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Documento anexado via WhatsApp (${documentTypeKeyToLabel(documentType)}: ${documentName}).`,
      });

      await documentDispatcher.clearPending(context.phone);

      const successMsg = [
        `✅ Documento anexado à solicitação ${protocolToken}.`,
        `• Tipo: ${documentTypeKeyToLabel(documentType)}`,
        `• Nome: ${documentName}`,
        document?.id ? `• ID: ${document.id}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      return buildToolResult({
        status: 'ok',
        message: successMsg,
        affected: document?.id
          ? [{ kind: 'document', id: document.id }]
          : undefined,
      });
    },
  };
}
