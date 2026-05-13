import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { ActivityType } from '../../../../../database/entities/surgery-request-activity.entity';
import { translateServiceError } from '../../helpers/service-error-translator';
import { FlowDraftDeps } from '../_types';

export function buildUpdateScDraftCommitTool(deps: FlowDraftDeps): AiTool {
  const {
    draftService,
    surgeryRequestRepo,
    activityRepo,
    patientRepo,
    patientsService,
    surgeryRequestsService,
  } = deps;
  return {
    name: 'update_sc_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'update_sc_draft_commit',
        description:
          'Aplica a atualização após confirmação (`confirm=true`). Roteia por `scope`: clinical/admin → `surgeryRequestRepo.update`; patient → `patientRepo.update`.',
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
            'Para aplicar a atualização, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'update_sc',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de atualização ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      const changeKeys = Object.keys(f.changes ?? {});
      if (!changeKeys.length) {
        return buildToolResult({
          status: 'error',
          message: 'Nenhuma alteração informada.',
        });
      }
      try {
        if (f.scope === 'patient') {
          const request = await surgeryRequestRepo.findOneSimple({
            id: f.surgeryRequestId,
          } as any);
          if (!request?.patientId) {
            return buildToolResult({
              status: 'error',
              message: 'Não foi possível localizar o paciente vinculado.',
            });
          }
          if (patientsService) {
            await patientsService.update(
              request.patientId,
              f.changes as any,
              context.userId,
            );
          } else {
            await patientRepo.update(request.patientId, f.changes as any);
          }
        } else {
          const changes = (f.changes ?? {}) as Record<string, any>;

          // Monta UpdateSurgeryRequestDto com os campos que pertencem ao DTO
          const dto: Record<string, any> = { id: f.surgeryRequestId! };
          const extraChanges: Record<string, any> = {};

          if (f.scope === 'clinical') {
            for (const [key, value] of Object.entries(changes)) {
              if (
                key === 'diagnosis' ||
                key === 'medicalReport' ||
                key === 'patientHistory'
              ) {
                dto[key] = value;
              } else if (key === 'cidCode') {
                dto['cid'] = { id: value, description: '' };
              } else {
                extraChanges[key] = value;
              }
            }
          } else if (f.scope === 'admin') {
            for (const [key, value] of Object.entries(changes)) {
              if (
                key === 'healthPlanRegistration' ||
                key === 'healthPlanType'
              ) {
                dto[key] = value;
              } else if (key === 'priority') {
                dto[key] = Number(value);
              } else {
                extraChanges[key] = value;
              }
            }
          }

          if (Object.keys(dto).length > 1 && surgeryRequestsService) {
            try {
              await surgeryRequestsService.update(dto as any, context.userId!);
            } catch (err) {
              return buildToolResult({
                status: 'error',
                message: `Erro ao atualizar: ${translateServiceError(err)}`,
              });
            }
          } else if (Object.keys(dto).length > 1) {
            // Fallback: sem service disponível, usa repo diretamente
            await surgeryRequestRepo.update(
              f.surgeryRequestId!,
              f.changes as any,
            );
          }

          if (Object.keys(extraChanges).length > 0) {
            await surgeryRequestRepo.update(
              f.surgeryRequestId!,
              extraChanges as any,
            );
          }
        }
        await activityRepo.create({
          surgeryRequestId: f.surgeryRequestId!,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Atualização (${f.scope}) via draft. Campos: ${changeKeys.join(', ')}.`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          message: `Atualização aplicada com sucesso na solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId}.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao atualizar: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };
}
