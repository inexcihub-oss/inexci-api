import { AiTool } from '../../tool.interface';
import { Permission } from 'src/shared/permissions';
import { buildToolResult } from '../../tool-result';
import { SurgeryRequestStatus } from '../../../../../database/entities/surgery-request.entity';
import { SendMethod } from '../../../../constants/send-method';
import { FlowDraftTransitionDeps } from '../_types';
import {
  assertCurrentStatusIs,
  extractTransitionErrorMessage,
} from '../_helpers';
import { STORAGE_FOLDERS } from '../../../../../config/storage.config';
import { recordAiActivity } from '../../helpers/surgery-request-access';
import { errorMessage } from '../../../../utils/error-message.util';

export function buildSendScDraftCommitTool(
  deps: FlowDraftTransitionDeps,
): AiTool {
  const {
    draftService,
    workflowService,
    activityRepo,
    surgeryRequestRepo,
    storageService,
  } = deps;
  return {
    name: 'send_sc_draft_commit',
    requiredPermission: Permission.SOLICITACOES,
    mutates: true,
    definition: {
      type: 'function',
      function: {
        name: 'send_sc_draft_commit',
        description:
          'Envia a SC para análise após confirmação (`confirm=true`). Avança status PENDING → SENT.',
        parameters: {
          type: 'object',
          properties: { confirm: { type: 'boolean' } },
          required: ['confirm'],
        },
      },
    },
    async execute(args, context) {
      if (!context.userId) {
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      }
      if (!args.confirm) {
        return buildToolResult({
          status: 'pending_confirmation',
          message:
            'Para enviar a solicitação, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(context.conversationId, 'send_sc');
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de envio ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      const status = await assertCurrentStatusIs(
        surgeryRequestRepo,
        f.surgeryRequestId!,
        SurgeryRequestStatus.PENDING,
        context,
      );
      if (status.error) return status.error;
      const surgeryRequestId = status.resolvedId!;

      try {
        const sendResult = await workflowService.sendRequest(
          surgeryRequestId,
          {
            method:
              f.method === 'email' ? SendMethod.EMAIL : SendMethod.DOWNLOAD,
            to: f.to,
            subject: f.subject,
            message: f.message,
            notifyPatient: f.notifyPatient,
          },
          context.userId,
        );
        await recordAiActivity(
          activityRepo,
          context,
          surgeryRequestId,
          `Solicitação enviada para análise (${f.method}).`,
        );
        await draftService.finalizeCommit(context.conversationId, {
          id: surgeryRequestId,
          label: f.surgeryRequestLabel,
        });

        const label = f.surgeryRequestLabel ?? surgeryRequestId;

        if (f.method === 'email') {
          return buildToolResult({
            status: 'ok',
            affected: [{ kind: 'surgery_request', id: surgeryRequestId }],
            message: `Solicitação ${label} enviada por e-mail para ${f.to} com sucesso.`,
            displayText: `Solicitação ${label} enviada por e-mail para ${f.to}. O PDF do laudo foi anexado ao envio.`,
          });
        }

        const pdfPayload = sendResult as
          | { pdf?: string; protocol?: string }
          | undefined;
        if (pdfPayload?.pdf) {
          try {
            const pdfBuffer = Buffer.from(pdfPayload.pdf, 'base64');
            const fileName = `solicitacao-${pdfPayload.protocol ?? label ?? surgeryRequestId}.pdf`;
            const path = await storageService.uploadBuffer(
              pdfBuffer,
              STORAGE_FOLDERS.WHATSAPP_DOWNLOADS,
              fileName,
              'application/pdf',
              context.ownerId ?? undefined,
            );
            const url = await storageService.getSignedUrl(path);
            return buildToolResult({
              status: 'ok',
              affected: [{ kind: 'surgery_request', id: surgeryRequestId }],
              message: `Solicitação ${label} marcada como enviada. Link de download gerado.`,
              displayText: `Solicitação ${label} pronta para download. Link válido por 1 hora: ${url}`,
            });
          } catch (uploadErr) {
            return buildToolResult({
              status: 'ok',
              affected: [{ kind: 'surgery_request', id: surgeryRequestId }],
              message: `Solicitação ${label} enviada. Falha ao subir o PDF para link temporário: ${errorMessage(uploadErr) || 'erro desconhecido'}.`,
              displayText: `Solicitação ${label} foi enviada para análise, mas não consegui gerar o link de download agora. Você pode baixar o PDF direto pela plataforma na página da solicitação.`,
            });
          }
        }

        return buildToolResult({
          status: 'ok',
          affected: [{ kind: 'surgery_request', id: surgeryRequestId }],
          message: `Solicitação ${label} enviada para análise com sucesso.`,
        });
      } catch (err) {
        return buildToolResult({
          status: 'error',
          message: extractTransitionErrorMessage(err, 'Erro ao enviar'),
        });
      }
    },
  };
}
