import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { OperationDraftService } from '../services/operation-draft.service';
import { PatientRepository } from '../../../database/repositories/patient.repository';
import { HospitalRepository } from '../../../database/repositories/hospital.repository';
import { HealthPlanRepository } from '../../../database/repositories/health-plan.repository';
import { ProcedureRepository } from '../../../database/repositories/procedure.repository';
import { UserRepository } from '../../../database/repositories/user.repository';
import { detokenizeArg } from '../pii/tool-pii-helpers';
import { buildToolResult } from './tool-result';
import {
  CreateHealthPlanDraftFields,
  CreateHospitalDraftFields,
  CreatePatientDraftFields,
  CreateProcedureDraftFields,
  OperationDraftType,
} from '../drafts/operation-draft.types';
import {
  findOwnedByNormalizedName,
  normalizeNameForCompare,
  resolveOwnerIdFromContext,
} from './catalog.helpers';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BIRTH_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function asText(context: ToolContext, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const detok = detokenizeArg(context, raw as any);
  const text = String(detok ?? '').trim();
  return text || null;
}

function trimmedName(value: string | null, max = 150): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 2 || cleaned.length > max) return null;
  return cleaned;
}

function normalizePhoneDigits(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) return null;
  return digits;
}

function normalizeCpfDigits(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length !== 11) return null;
  if (/^(\d)\1{10}$/.test(digits)) return null;
  const verifyDigit = (slice: string, factorStart: number): number => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      sum += Number(slice[i]) * (factorStart - i);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  const dv1 = verifyDigit(digits.slice(0, 9), 10);
  const dv2 = verifyDigit(digits.slice(0, 10), 11);
  if (dv1 !== Number(digits[9]) || dv2 !== Number(digits[10])) return null;
  return digits;
}

function normalizeBirthDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!BIRTH_DATE_REGEX.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  if (date.getTime() > Date.now()) return null;
  if (year < 1900) return null;
  return raw;
}

function normalizeEmail(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (!EMAIL_REGEX.test(raw)) return null;
  return raw;
}

interface CadastroDraftDeps {
  draftService: OperationDraftService;
  patientRepo: PatientRepository;
  hospitalRepo: HospitalRepository;
  healthPlanRepo: HealthPlanRepository;
  procedureRepo: ProcedureRepository;
  userRepo: UserRepository;
}

/**
 * Tools de cadastros estruturados como sub-drafts.
 *
 * Cada cadastro (paciente, hospital, convênio, procedimento) tem:
 *  - tools `*_draft_set_*` que aceitam parâmetros e validam,
 *  - `*_draft_status` lista campos pendentes,
 *  - `*_draft_preview` gera o preview e marca `pending_confirmation`,
 *  - `*_draft_commit` cria o registro (com `confirm=true`),
 *  - `*_draft_cancel` descarta o rascunho.
 *
 * Quando um cadastro é aberto **dentro de** um `create_sc` (pelo
 * `plan_actions`), `OperationDraftService.finalizeCommit` restaura
 * automaticamente o draft pai e popula o campo de retorno
 * (`patientId`, `hospitalId`, `healthPlanId` ou `procedureId`).
 */
export function buildCadastroDraftTools(deps: CadastroDraftDeps): AiTool[] {
  const {
    draftService,
    patientRepo,
    hospitalRepo,
    healthPlanRepo,
    procedureRepo,
    userRepo,
  } = deps;

  /**
   * Bloqueia uso de qualquer `*_draft_set_*` quando o draft ativo não
   * é do tipo esperado. Retorna a string já no formato `ToolResult`.
   */
  async function guardDraft(
    context: ToolContext,
    type: OperationDraftType,
  ): Promise<string | null> {
    const current = await draftService.getCurrent(context.conversationId);
    if (!current) {
      return buildToolResult({
        status: 'blocked',
        message: `Não há rascunho de "${type}" ativo. Chame \`plan_actions\` com intent="${type}" para iniciar.`,
      });
    }
    if (current.type !== type) {
      return buildToolResult({
        status: 'blocked',
        message: `O rascunho ativo é do tipo "${current.type}", não "${type}". Conclua ou cancele antes.`,
      });
    }
    return null;
  }

  /* ============================================================
   * CREATE PATIENT
   * ============================================================ */

  const patientSetName: AiTool = {
    name: 'patient_draft_set_name',
    definition: {
      type: 'function',
      function: {
        name: 'patient_draft_set_name',
        description:
          'Define o nome do paciente no rascunho `create_patient`. Mínimo 2 caracteres.',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'create_patient');
      if (blocked) return blocked;
      const name = trimmedName(asText(context, args.name));
      if (!name) {
        return buildToolResult({
          status: 'error',
          message: '`name` é obrigatório (mínimo 2 caracteres).',
        });
      }
      await draftService.setFields(context.conversationId, 'create_patient', {
        name,
      } satisfies Partial<CreatePatientDraftFields>);
      const v = await draftService.validate(
        context.conversationId,
        'create_patient',
      );
      return buildToolResult({
        status: v.isReady ? 'ok' : 'needs_input',
        data: { name },
        nextRequiredFields: v.missing,
      });
    },
  };

  const patientSetPhone: AiTool = {
    name: 'patient_draft_set_phone',
    definition: {
      type: 'function',
      function: {
        name: 'patient_draft_set_phone',
        description:
          'Define o telefone do paciente (10 a 13 dígitos, com ou sem máscara).',
        parameters: {
          type: 'object',
          properties: { phone: { type: 'string' } },
          required: ['phone'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'create_patient');
      if (blocked) return blocked;
      const phone = normalizePhoneDigits(asText(context, args.phone));
      if (!phone) {
        return buildToolResult({
          status: 'error',
          message: '`phone` deve conter de 10 a 13 dígitos.',
        });
      }
      await draftService.setFields(context.conversationId, 'create_patient', {
        phone,
      });
      const v = await draftService.validate(
        context.conversationId,
        'create_patient',
      );
      return buildToolResult({
        status: v.isReady ? 'ok' : 'needs_input',
        data: { phone },
        nextRequiredFields: v.missing,
      });
    },
  };

  const patientSetEmail: AiTool = {
    name: 'patient_draft_set_email',
    definition: {
      type: 'function',
      function: {
        name: 'patient_draft_set_email',
        description: 'Define o e-mail do paciente. Aceite `null` para limpar.',
        parameters: {
          type: 'object',
          properties: { email: { type: ['string', 'null'] } },
          required: ['email'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'create_patient');
      if (blocked) return blocked;
      if (args.email === null) {
        await draftService.setFields(context.conversationId, 'create_patient', {
          email: null,
        });
        return buildToolResult({ status: 'ok', data: { email: null } });
      }
      const email = normalizeEmail(asText(context, args.email));
      if (!email) {
        return buildToolResult({
          status: 'error',
          message: '`email` em formato inválido.',
        });
      }
      await draftService.setFields(context.conversationId, 'create_patient', {
        email,
      });
      return buildToolResult({ status: 'ok', data: { email } });
    },
  };

  const patientSetCpf: AiTool = {
    name: 'patient_draft_set_cpf',
    definition: {
      type: 'function',
      function: {
        name: 'patient_draft_set_cpf',
        description: 'Define o CPF do paciente (11 dígitos, DV válido).',
        parameters: {
          type: 'object',
          properties: { cpf: { type: ['string', 'null'] } },
          required: ['cpf'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'create_patient');
      if (blocked) return blocked;
      if (args.cpf === null) {
        await draftService.setFields(context.conversationId, 'create_patient', {
          cpf: null,
        });
        return buildToolResult({ status: 'ok', data: { cpf: null } });
      }
      const cpf = normalizeCpfDigits(asText(context, args.cpf));
      if (!cpf) {
        return buildToolResult({
          status: 'error',
          message: '`cpf` inválido (precisa de 11 dígitos com DV correto).',
        });
      }
      await draftService.setFields(context.conversationId, 'create_patient', {
        cpf,
      });
      return buildToolResult({ status: 'ok', data: { cpf } });
    },
  };

  const patientSetBirthDate: AiTool = {
    name: 'patient_draft_set_birth_date',
    definition: {
      type: 'function',
      function: {
        name: 'patient_draft_set_birth_date',
        description:
          'Define data de nascimento (AAAA-MM-DD). Aceite `null` para limpar.',
        parameters: {
          type: 'object',
          properties: { birth_date: { type: ['string', 'null'] } },
          required: ['birth_date'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'create_patient');
      if (blocked) return blocked;
      if (args.birth_date === null) {
        await draftService.setFields(context.conversationId, 'create_patient', {
          birthDate: null,
        });
        return buildToolResult({ status: 'ok', data: { birthDate: null } });
      }
      const birthDate = normalizeBirthDate(asText(context, args.birth_date));
      if (!birthDate) {
        return buildToolResult({
          status: 'error',
          message:
            '`birth_date` deve estar em AAAA-MM-DD e ser válida e não futura.',
        });
      }
      await draftService.setFields(context.conversationId, 'create_patient', {
        birthDate,
      });
      return buildToolResult({ status: 'ok', data: { birthDate } });
    },
  };

  const patientSetGender: AiTool = {
    name: 'patient_draft_set_gender',
    definition: {
      type: 'function',
      function: {
        name: 'patient_draft_set_gender',
        description: 'Define sexo do paciente (M, F ou O).',
        parameters: {
          type: 'object',
          properties: {
            gender: {
              type: ['string', 'null'],
              enum: ['M', 'F', 'O', null],
            },
          },
          required: ['gender'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'create_patient');
      if (blocked) return blocked;
      if (args.gender === null) {
        await draftService.setFields(context.conversationId, 'create_patient', {
          gender: null,
        });
        return buildToolResult({ status: 'ok', data: { gender: null } });
      }
      const raw = String(args.gender ?? '')
        .trim()
        .toUpperCase();
      if (raw !== 'M' && raw !== 'F' && raw !== 'O') {
        return buildToolResult({
          status: 'error',
          message: '`gender` deve ser "M", "F" ou "O".',
        });
      }
      await draftService.setFields(context.conversationId, 'create_patient', {
        gender: raw as 'M' | 'F' | 'O',
      });
      return buildToolResult({ status: 'ok', data: { gender: raw } });
    },
  };

  const patientPreview: AiTool = {
    name: 'patient_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'patient_draft_preview',
        description:
          'Gera o preview do rascunho de paciente para confirmar com o usuário.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'create_patient',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de paciente ativo.',
        });
      }
      if (!v.isReady) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam: ${v.missing.join(', ')}.`,
          nextRequiredFields: v.missing,
        });
      }
      const { text } = await draftService.getPreview(
        context.conversationId,
        'create_patient',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };

  const patientCommit: AiTool = {
    name: 'patient_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'patient_draft_commit',
        description:
          'Cria o paciente após confirmação. Exige `confirm=true`. Quando aberto como sub-draft de uma SC, popula `patientId` no draft pai automaticamente.',
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
            'Para criar o paciente, chame esta tool com `confirm=true` após confirmação do usuário.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'create_patient',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam campos obrigatórios: ${v.missing.join(', ')}.`
            : 'Não há rascunho de paciente ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const fields = v.draft.fields;

      const requester = await userRepo.findOne({ id: context.userId } as any);
      if (!requester) {
        return buildToolResult({
          status: 'error',
          message: 'Usuário não encontrado.',
        });
      }
      const ownerId = (requester as any).ownerId;

      const accessibleDoctorIds = context.accessibleDoctorIds || [];
      let doctorId = fields.doctorId;
      if (!doctorId) {
        if (accessibleDoctorIds.length === 1) {
          doctorId = accessibleDoctorIds[0];
        } else {
          return buildToolResult({
            status: 'needs_input',
            message:
              'Múltiplos médicos acessíveis: informe `doctor_name_or_id` antes de commitar.',
            nextRequiredFields: ['doctorId'],
          });
        }
      }

      if (fields.cpf) {
        const existing = await patientRepo.findMany({
          ownerId,
          cpf: fields.cpf,
        } as any);
        if (existing.length > 0) {
          return buildToolResult({
            status: 'blocked',
            message: `Já existe paciente cadastrado com este CPF: ${existing[0].name}.`,
            data: { existingPatientId: existing[0].id },
          });
        }
      }

      const created = await patientRepo.create({
        doctorId,
        ownerId,
        name: fields.name,
        phone: fields.phone,
        email: fields.email ?? null,
        cpf: fields.cpf ?? null,
        gender: fields.gender ?? null,
        birthDate: fields.birthDate
          ? new Date(`${fields.birthDate}T00:00:00Z`)
          : null,
        active: true,
      } as any);

      await draftService.finalizeCommit(context.conversationId, {
        id: created.id,
        label: created.name,
      });

      return buildToolResult({
        status: 'ok',
        data: { id: created.id, name: created.name },
        message: `Paciente "${created.name}" cadastrado com sucesso.`,
        displayText: `Paciente "${created.name}" cadastrado com sucesso. Retomando o fluxo anterior, se houver.`,
      });
    },
  };

  const patientCancel: AiTool = {
    name: 'patient_draft_cancel',
    definition: {
      type: 'function',
      function: {
        name: 'patient_draft_cancel',
        description: 'Cancela o rascunho de criação de paciente.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      await draftService.cancel(context.conversationId);
      return buildToolResult({
        status: 'ok',
        message: 'Rascunho de paciente cancelado.',
      });
    },
  };

  const patientStatus: AiTool = {
    name: 'patient_draft_status',
    definition: {
      type: 'function',
      function: {
        name: 'patient_draft_status',
        description: 'Mostra o estado atual do rascunho de paciente.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'create_patient',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de paciente ativo.',
        });
      }
      return buildToolResult({
        status: v.isReady ? 'ok' : 'needs_input',
        data: v.draft.fields,
        nextRequiredFields: v.missing,
      });
    },
  };

  /* ============================================================
   * CREATE HOSPITAL
   * ============================================================ */

  const hospitalSetName: AiTool = {
    name: 'hospital_draft_set_name',
    definition: {
      type: 'function',
      function: {
        name: 'hospital_draft_set_name',
        description: 'Define o nome do hospital no rascunho `create_hospital`.',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'create_hospital');
      if (blocked) return blocked;
      const name = trimmedName(asText(context, args.name));
      if (!name) {
        return buildToolResult({
          status: 'error',
          message: '`name` deve ter de 2 a 150 caracteres.',
        });
      }
      await draftService.setFields(context.conversationId, 'create_hospital', {
        name,
      } satisfies Partial<CreateHospitalDraftFields>);
      return buildToolResult({ status: 'ok', data: { name } });
    },
  };

  const hospitalPreview: AiTool = {
    name: 'hospital_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'hospital_draft_preview',
        description: 'Gera o preview do rascunho de hospital.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'create_hospital',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de hospital ativo.',
        });
      }
      if (!v.isReady) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam: ${v.missing.join(', ')}.`,
          nextRequiredFields: v.missing,
        });
      }
      const { text } = await draftService.getPreview(
        context.conversationId,
        'create_hospital',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };

  const hospitalCommit: AiTool = {
    name: 'hospital_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'hospital_draft_commit',
        description:
          'Cria o hospital após confirmação (`confirm=true`). Se aberto como sub-draft de SC, popula `hospitalId` no pai.',
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
            'Para criar o hospital, chame esta tool com `confirm=true` após confirmação do usuário.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'create_hospital',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam campos obrigatórios: ${v.missing.join(', ')}.`
            : 'Não há rascunho de hospital ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const ownerId = await resolveOwnerIdFromContext(context, userRepo);
      if (!ownerId) {
        return buildToolResult({
          status: 'error',
          message: 'Não foi possível identificar a clínica do usuário.',
        });
      }
      const existing = await findOwnedByNormalizedName(
        hospitalRepo as any,
        v.draft.fields.name!,
        ownerId,
      );
      if (existing) {
        await draftService.finalizeCommit(context.conversationId, {
          id: existing.id,
          label: existing.name,
        });
        return buildToolResult({
          status: 'ok',
          data: { id: existing.id, name: existing.name, reused: true },
          message: `Hospital "${existing.name}" já existia — usando o cadastro existente.`,
        });
      }
      const created = await hospitalRepo.create({
        ownerId,
        name: v.draft.fields.name,
        active: true,
      } as any);
      await draftService.finalizeCommit(context.conversationId, {
        id: created.id,
        label: created.name,
      });
      return buildToolResult({
        status: 'ok',
        data: { id: created.id, name: created.name },
        message: `Hospital "${created.name}" cadastrado com sucesso.`,
      });
    },
  };

  const hospitalCancel: AiTool = {
    name: 'hospital_draft_cancel',
    definition: {
      type: 'function',
      function: {
        name: 'hospital_draft_cancel',
        description: 'Cancela o rascunho de hospital.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      await draftService.cancel(context.conversationId);
      return buildToolResult({
        status: 'ok',
        message: 'Rascunho de hospital cancelado.',
      });
    },
  };

  const hospitalStatus: AiTool = {
    name: 'hospital_draft_status',
    definition: {
      type: 'function',
      function: {
        name: 'hospital_draft_status',
        description: 'Mostra o estado do rascunho de hospital.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'create_hospital',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de hospital ativo.',
        });
      }
      return buildToolResult({
        status: v.isReady ? 'ok' : 'needs_input',
        data: v.draft.fields,
        nextRequiredFields: v.missing,
      });
    },
  };

  /* ============================================================
   * CREATE HEALTH PLAN
   * ============================================================ */

  const healthPlanSetName: AiTool = {
    name: 'health_plan_draft_set_name',
    definition: {
      type: 'function',
      function: {
        name: 'health_plan_draft_set_name',
        description:
          'Define o nome do convênio no rascunho `create_health_plan`.',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'create_health_plan');
      if (blocked) return blocked;
      const name = trimmedName(asText(context, args.name));
      if (!name) {
        return buildToolResult({
          status: 'error',
          message: '`name` deve ter de 2 a 150 caracteres.',
        });
      }
      await draftService.setFields(
        context.conversationId,
        'create_health_plan',
        { name } satisfies Partial<CreateHealthPlanDraftFields>,
      );
      return buildToolResult({ status: 'ok', data: { name } });
    },
  };

  const healthPlanPreview: AiTool = {
    name: 'health_plan_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'health_plan_draft_preview',
        description: 'Gera o preview do rascunho de convênio.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'create_health_plan',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de convênio ativo.',
        });
      }
      if (!v.isReady) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam: ${v.missing.join(', ')}.`,
          nextRequiredFields: v.missing,
        });
      }
      const { text } = await draftService.getPreview(
        context.conversationId,
        'create_health_plan',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };

  const healthPlanCommit: AiTool = {
    name: 'health_plan_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'health_plan_draft_commit',
        description:
          'Cria o convênio após confirmação (`confirm=true`). Se aberto como sub-draft de SC, popula `healthPlanId` no pai.',
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
            'Para criar o convênio, chame esta tool com `confirm=true` após confirmação do usuário.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'create_health_plan',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam campos obrigatórios: ${v.missing.join(', ')}.`
            : 'Não há rascunho de convênio ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const ownerId = await resolveOwnerIdFromContext(context, userRepo);
      if (!ownerId) {
        return buildToolResult({
          status: 'error',
          message: 'Não foi possível identificar a clínica do usuário.',
        });
      }
      const existing = await findOwnedByNormalizedName(
        healthPlanRepo as any,
        v.draft.fields.name!,
        ownerId,
      );
      if (existing) {
        await draftService.finalizeCommit(context.conversationId, {
          id: existing.id,
          label: existing.name,
        });
        return buildToolResult({
          status: 'ok',
          data: { id: existing.id, name: existing.name, reused: true },
          message: `Convênio "${existing.name}" já existia — usando o cadastro existente.`,
        });
      }
      const created = await healthPlanRepo.create({
        ownerId,
        name: v.draft.fields.name,
        active: true,
      } as any);
      await draftService.finalizeCommit(context.conversationId, {
        id: created.id,
        label: created.name,
      });
      return buildToolResult({
        status: 'ok',
        data: { id: created.id, name: created.name },
        message: `Convênio "${created.name}" cadastrado com sucesso.`,
      });
    },
  };

  const healthPlanCancel: AiTool = {
    name: 'health_plan_draft_cancel',
    definition: {
      type: 'function',
      function: {
        name: 'health_plan_draft_cancel',
        description: 'Cancela o rascunho de convênio.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      await draftService.cancel(context.conversationId);
      return buildToolResult({
        status: 'ok',
        message: 'Rascunho de convênio cancelado.',
      });
    },
  };

  const healthPlanStatus: AiTool = {
    name: 'health_plan_draft_status',
    definition: {
      type: 'function',
      function: {
        name: 'health_plan_draft_status',
        description: 'Mostra o estado do rascunho de convênio.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'create_health_plan',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de convênio ativo.',
        });
      }
      return buildToolResult({
        status: v.isReady ? 'ok' : 'needs_input',
        data: v.draft.fields,
        nextRequiredFields: v.missing,
      });
    },
  };

  /* ============================================================
   * CREATE PROCEDURE
   * ============================================================ */

  const procedureSetName: AiTool = {
    name: 'procedure_draft_set_name',
    definition: {
      type: 'function',
      function: {
        name: 'procedure_draft_set_name',
        description:
          'Define o nome do procedimento no rascunho `create_procedure`.',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'create_procedure');
      if (blocked) return blocked;
      const name = trimmedName(asText(context, args.name), 255);
      if (!name) {
        return buildToolResult({
          status: 'error',
          message: '`name` deve ter de 2 a 255 caracteres.',
        });
      }
      await draftService.setFields(context.conversationId, 'create_procedure', {
        name,
      } satisfies Partial<CreateProcedureDraftFields>);
      return buildToolResult({ status: 'ok', data: { name } });
    },
  };

  const procedurePreview: AiTool = {
    name: 'procedure_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'procedure_draft_preview',
        description: 'Gera o preview do rascunho de procedimento.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'create_procedure',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de procedimento ativo.',
        });
      }
      if (!v.isReady) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam: ${v.missing.join(', ')}.`,
          nextRequiredFields: v.missing,
        });
      }
      const { text } = await draftService.getPreview(
        context.conversationId,
        'create_procedure',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };

  const procedureCommit: AiTool = {
    name: 'procedure_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'procedure_draft_commit',
        description:
          'Cria o procedimento no catálogo global após confirmação (`confirm=true`). Se aberto como sub-draft de SC, popula `procedureId` no pai.',
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
            'Para criar o procedimento, chame esta tool com `confirm=true` após confirmação do usuário.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'create_procedure',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam campos obrigatórios: ${v.missing.join(', ')}.`
            : 'Não há rascunho de procedimento ativo.',
          nextRequiredFields: v.missing,
        });
      }

      const rawName = v.draft.fields.name!;
      const target = normalizeNameForCompare(rawName);
      let existing = await procedureRepo.findOne({ name: rawName } as any);
      if (!existing) {
        const candidates = await procedureRepo.findMany({} as any, 0, 200);
        existing =
          candidates.find(
            (item) => normalizeNameForCompare(item.name) === target,
          ) ?? null;
      }
      if (existing) {
        await draftService.finalizeCommit(context.conversationId, {
          id: existing.id,
          label: existing.name,
        });
        return buildToolResult({
          status: 'ok',
          data: { id: existing.id, name: existing.name, reused: true },
          message: `Procedimento "${existing.name}" já existia — usando o cadastro existente.`,
        });
      }
      const created = await procedureRepo.create({ name: rawName } as any);
      await draftService.finalizeCommit(context.conversationId, {
        id: created.id,
        label: created.name,
      });
      return buildToolResult({
        status: 'ok',
        data: { id: created.id, name: created.name },
        message: `Procedimento "${created.name}" cadastrado com sucesso.`,
      });
    },
  };

  const procedureCancel: AiTool = {
    name: 'procedure_draft_cancel',
    definition: {
      type: 'function',
      function: {
        name: 'procedure_draft_cancel',
        description: 'Cancela o rascunho de procedimento.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      await draftService.cancel(context.conversationId);
      return buildToolResult({
        status: 'ok',
        message: 'Rascunho de procedimento cancelado.',
      });
    },
  };

  const procedureStatus: AiTool = {
    name: 'procedure_draft_status',
    definition: {
      type: 'function',
      function: {
        name: 'procedure_draft_status',
        description: 'Mostra o estado do rascunho de procedimento.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'create_procedure',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de procedimento ativo.',
        });
      }
      return buildToolResult({
        status: v.isReady ? 'ok' : 'needs_input',
        data: v.draft.fields,
        nextRequiredFields: v.missing,
      });
    },
  };

  return [
    patientSetName,
    patientSetPhone,
    patientSetEmail,
    patientSetCpf,
    patientSetBirthDate,
    patientSetGender,
    patientPreview,
    patientCommit,
    patientCancel,
    patientStatus,
    hospitalSetName,
    hospitalPreview,
    hospitalCommit,
    hospitalCancel,
    hospitalStatus,
    healthPlanSetName,
    healthPlanPreview,
    healthPlanCommit,
    healthPlanCancel,
    healthPlanStatus,
    procedureSetName,
    procedurePreview,
    procedureCommit,
    procedureCancel,
    procedureStatus,
  ];
}
