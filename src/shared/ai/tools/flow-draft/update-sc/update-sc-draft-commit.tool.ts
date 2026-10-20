import { AiTool } from '../../tool.interface';
import { draftConfirmationFingerprint } from '../../helpers/draft-fingerprint';
import { Permission } from 'src/shared/permissions';
import { buildToolResult } from '../../tool-result';
import { translateServiceError } from '../../helpers/service-error-translator';
import { FlowDraftDeps } from '../_types';
import {
  getAuthorizedRequest,
  recordAiActivity,
} from '../../helpers/surgery-request-access';
import { errorMessage } from '../../../../utils/error-message.util';
import { UpdatePatientDto } from '../../../../../modules/patients/dto/update-patient.dto';
import { UpdateSurgeryRequestDto } from '../../../../../modules/surgery-requests/dto/update-surgery-request.dto';
import { SurgeryRequestPriority } from '../../../../../database/entities/surgery-request.entity';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

const CLINICAL_SECTION_TITLES: Record<string, string> = {
  diagnosis: 'Diagnóstico e Indicação',
  patientHistory: 'Histórico Clínico',
  medicalReport: 'Laudo',
  surgeryDescription: 'Descrição do Procedimento',
};

const ADMIN_KEYS = new Set([
  'priority',
  'healthPlanRegistration',
  'healthPlanType',
]);

const CLINICAL_KEYS = new Set([
  'cidCode',
  ...Object.keys(CLINICAL_SECTION_TITLES),
]);

const PATIENT_KEYS = new Set([
  'name',
  'cpf',
  'phone',
  'secondaryPhone',
  'email',
  'gender',
  'birthDate',
  'healthPlanNumber',
  'healthPlanType',
  'zipCode',
  'address',
  'addressNumber',
  'addressComplement',
  'neighborhood',
  'city',
  'state',
  'medicalNotes',
]);

export const UPDATE_SC_ALLOWED_KEYS: Record<string, ReadonlySet<string>> = {
  admin: ADMIN_KEYS,
  clinical: CLINICAL_KEYS,
  patient: PATIENT_KEYS,
};

function partitionChanges(
  scope: string,
  changes: Record<string, unknown>,
): { allowed: Record<string, unknown>; ignored: string[] } {
  const allowedKeys = UPDATE_SC_ALLOWED_KEYS[scope];
  const allowed: Record<string, unknown> = {};
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (allowedKeys?.has(key)) allowed[key] = value;
    else ignored.push(key);
  }
  return { allowed, ignored };
}

const PRIORITY_VALUES = new Set<number>(
  Object.values(SurgeryRequestPriority).filter(
    (v): v is number => typeof v === 'number',
  ),
);

function normalizePriority(value: unknown): number | null {
  if (typeof value === 'number') {
    return PRIORITY_VALUES.has(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const byName =
    SurgeryRequestPriority[
      trimmed.toUpperCase() as keyof typeof SurgeryRequestPriority
    ];
  if (typeof byName === 'number') return byName;
  const numeric = Number(trimmed);
  return /^\d+$/.test(trimmed) && PRIORITY_VALUES.has(numeric) ? numeric : null;
}

function flattenErrors(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((e) => {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map(
      () => `${path} inválido`,
    );
    return [...new Set(own), ...flattenErrors(e.children ?? [], path)];
  });
}

async function validateDto<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): Promise<{ dto: T; errors: string[] }> {
  const dto = plainToInstance(cls, plain);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, errors: flattenErrors(errors) };
}

function ignoredSuffix(ignored: string[]): string {
  return ignored.length
    ? ` Campos ignorados (não editáveis por aqui): ${ignored.join(', ')}.`
    : '';
}

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
    requiresConfirmation: true,
    confirmationFingerprint: draftConfirmationFingerprint(deps.draftService),
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
      const acesso = await getAuthorizedRequest(
        surgeryRequestRepo,
        f.surgeryRequestId,
        context,
      );
      if (!acesso.ok) {
        return buildToolResult({ status: 'error', message: acesso.message });
      }
      const scope = f.scope ?? '';
      if (!UPDATE_SC_ALLOWED_KEYS[scope]) {
        return buildToolResult({
          status: 'error',
          message: 'Escopo inválido. Use clinical, admin ou patient.',
        });
      }
      const rawChanges =
        f.changes && typeof f.changes === 'object' && !Array.isArray(f.changes)
          ? f.changes
          : {};
      if (!Object.keys(rawChanges).length) {
        return buildToolResult({
          status: 'error',
          message: 'Nenhuma alteração informada.',
        });
      }
      const { allowed, ignored } = partitionChanges(scope, rawChanges);
      const changeKeys = Object.keys(allowed);
      if (!changeKeys.length) {
        return buildToolResult({
          status: 'error',
          message: `Nenhuma alteração permitida para o escopo ${scope}.${ignoredSuffix(ignored)}`,
          data: { ignoredFields: ignored },
        });
      }
      try {
        if (scope === 'patient') {
          const request = await surgeryRequestRepo.findOneSimple({
            id: f.surgeryRequestId,
          });
          if (!request?.patientId) {
            return buildToolResult({
              status: 'error',
              message: 'Não foi possível localizar o paciente vinculado.',
            });
          }
          const { dto, errors } = await validateDto(UpdatePatientDto, allowed);
          if (errors.length) {
            return buildToolResult({
              status: 'error',
              message: `Dados inválidos: ${errors.join(', ')}.${ignoredSuffix(ignored)}`,
              data: { ignoredFields: ignored },
            });
          }
          await patientsService.update(request.patientId, dto, context.userId);
        } else {
          const plain: Record<string, unknown> = { id: f.surgeryRequestId };
          const clinicalSectionUpdates: Array<{
            title: string;
            value: string;
          }> = [];

          for (const [key, value] of Object.entries(allowed)) {
            if (key === 'cidCode') {
              if (typeof value !== 'string' || !value.trim()) {
                return buildToolResult({
                  status: 'error',
                  message: `Dados inválidos: cidCode inválido.${ignoredSuffix(ignored)}`,
                  data: { ignoredFields: ignored },
                });
              }
              plain.cid = { code: value.trim() };
            } else if (CLINICAL_SECTION_TITLES[key]) {
              if (typeof value === 'string' && value.trim()) {
                clinicalSectionUpdates.push({
                  title: CLINICAL_SECTION_TITLES[key],
                  value,
                });
              }
            } else if (key === 'priority') {
              const priority = normalizePriority(value);
              if (priority === null) {
                return buildToolResult({
                  status: 'error',
                  message: `Dados inválidos: priority deve ser LOW, MEDIUM, HIGH ou URGENT (1 a 4).${ignoredSuffix(ignored)}`,
                  data: { ignoredFields: ignored },
                });
              }
              plain.priority = priority;
            } else {
              plain[key] = value;
            }
          }

          if (Object.keys(plain).length > 1) {
            const { dto, errors } = await validateDto(
              UpdateSurgeryRequestDto,
              plain,
            );
            if (errors.length) {
              return buildToolResult({
                status: 'error',
                message: `Dados inválidos: ${errors.join(', ')}.${ignoredSuffix(ignored)}`,
                data: { ignoredFields: ignored },
              });
            }
            try {
              await surgeryRequestsService.update(dto, context.userId);
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
          `Atualização (${scope}). Campos: ${changeKeys.join(', ')}.`,
        );
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          affected: [{ kind: 'surgery_request', id: f.surgeryRequestId! }],
          message: `Atualização aplicada com sucesso na solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId}.${ignoredSuffix(ignored)}`,
          data: { appliedFields: changeKeys, ignoredFields: ignored },
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
