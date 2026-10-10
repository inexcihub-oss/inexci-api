import { AiTool } from '../../tool.interface';
import { Permission } from 'src/shared/permissions';
import { buildToolResult } from '../../tool-result';
import { translateServiceError } from '../../helpers/service-error-translator';
import { FlowDraftDeps } from '../_types';
import { recordAiActivity } from '../../helpers/surgery-request-access';
import { errorMessage } from '../../../../utils/error-message.util';
import { UpdatePatientDto } from '../../../../../modules/patients/dto/update-patient.dto';
import { UpdateSurgeryRequestDto } from '../../../../../modules/surgery-requests/dto/update-surgery-request.dto';

const CLINICAL_SECTION_TITLES: Record<string, string> = {
  diagnosis: 'Diagnóstico e Indicação',
  patientHistory: 'Histórico Clínico',
  medicalReport: 'Laudo',
  surgeryDescription: 'Descrição do Procedimento',
};

export function buildUpdateScDraftCommitTool(deps: FlowDraftDeps): AiTool {
  const {
    draftService,
    surgeryRequestRepo,
    activityRepo,
    patientsService,
    surgeryRequestsService,
  } = deps;
  return {
    name: 'update_sc_draft_commit',
    requiredPermission: Permission.SOLICITACOES,
    mutates: true,
    definition: {
      type: 'function',
      function: {
        name: 'update_sc_draft_commit',
        description:
          'Aplica a atualização após confirmação (`confirm=true`). Roteia por `scope`: clinical/admin → `surgeryRequestsService.update`; patient → `patientsService.update`.',
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
          });
          if (!request?.patientId) {
            return buildToolResult({
              status: 'error',
              message: 'Não foi possível localizar o paciente vinculado.',
            });
          }
          await patientsService.update(
            request.patientId,
            f.changes as UpdatePatientDto,
            context.userId,
          );
        } else {
          const changes: Record<string, unknown> = f.changes ?? {};

          const dto: Record<string, unknown> = { id: f.surgeryRequestId! };
          const extraChanges: Record<string, unknown> = {};
          const clinicalSectionUpdates: Array<{
            title: string;
            value: string;
          }> = [];

          if (f.scope === 'clinical') {
            for (const [key, value] of Object.entries(changes)) {
              if (key === 'cidCode') {
                dto['cid'] = { code: value };
              } else if (CLINICAL_SECTION_TITLES[key]) {
                if (typeof value === 'string' && value.trim()) {
                  clinicalSectionUpdates.push({
                    title: CLINICAL_SECTION_TITLES[key],
                    value,
                  });
                }
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

          if (Object.keys(dto).length > 1 || Object.keys(extraChanges).length) {
            try {
              await surgeryRequestsService.update(
                {
                  ...dto,
                  ...extraChanges,
                } as unknown as UpdateSurgeryRequestDto,
                context.userId,
              );
            } catch (err) {
              return buildToolResult({
                status: 'error',
                message: `Erro ao atualizar: ${translateServiceError(err)}`,
              });
            }
          }

          for (const section of clinicalSectionUpdates) {
            await surgeryRequestsService.upsertReportSectionByTitle(
              f.surgeryRequestId!,
              section.title,
              section.value,
            );
          }
        }
        await recordAiActivity(
          activityRepo,
          context,
          f.surgeryRequestId!,
          `Atualização (${f.scope}). Campos: ${changeKeys.join(', ')}.`,
        );
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          affected: [{ kind: 'surgery_request', id: f.surgeryRequestId! }],
          message: `Atualização aplicada com sucesso na solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId}.`,
        });
      } catch (err) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao atualizar: ${errorMessage(err) || 'erro desconhecido'}`,
        });
      }
    },
  };
}
