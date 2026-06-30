import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { ActivityType } from '../../../../../database/entities/surgery-request-activity.entity';
import { SurgeryRequestStatus } from '../../../../../database/entities/surgery-request.entity';
import { SendMethod } from '../../../../constants/send-method';
import { FlowDraftTransitionDeps } from '../_types';
import { assertCurrentStatusIs, extractTransitionErrorMessage } from '../_helpers';
import { STORAGE_FOLDERS } from '../../../../../config/storage.config';

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
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      if (!context.userId) {
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      }
      if (!(args as any).confirm) {
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
          } as any,
          context.userId,
        );
        await activityRepo.create({
          surgeryRequestId,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Solicitação enviada para análise (${f.method}).`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: surgeryRequestId,
          label: f.surgeryRequestLabel,
        });

        const label = f.surgeryRequestLabel ?? surgeryRequestId;

        if (f.method === 'email') {
          return buildToolResult({
            status: 'ok',
            message: `Solicitação ${label} enviada por e-mail para ${f.to} com sucesso.`,
            displayText: `Solicitação ${label} enviada por e-mail para ${f.to}. O PDF do laudo foi anexado ao envio.`,
          });
        }

        // DOWNLOAD: tenta subir o PDF retornado pelo handler para o
        // Supabase e devolver uma signed URL ao usuário. Quando o upload
        // falha, ainda confirmamos a transição (ela já aconteceu) e
        // pedimos ao usuário para baixar pela plataforma.
        const pdfPayload = sendResult as
          | { pdf?: string; protocol?: string }
          | undefined;
        if (pdfPayload?.pdf && storageService) {
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
              message: `Solicitação ${label} marcada como enviada. Link de download gerado.`,
              displayText: `Solicitação ${label} pronta para download. Link válido por 1 hora: ${url}`,
            });
          } catch (uploadErr: any) {
            // Não-crítico: a transição já aconteceu. Apenas avisamos.
            return buildToolResult({
              status: 'ok',
              message: `Solicitação ${label} enviada. Falha ao subir o PDF para link temporário: ${uploadErr?.message || 'erro desconhecido'}.`,
              displayText: `Solicitação ${label} foi enviada para análise, mas não consegui gerar o link de download agora. Você pode baixar o PDF direto pela plataforma na página da solicitação.`,
            });
          }
        }

        return buildToolResult({
          status: 'ok',
          message: `Solicitação ${label} enviada para análise com sucesso.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: extractTransitionErrorMessage(err, 'Erro ao enviar'),
        });
      }
    },
  };
}
