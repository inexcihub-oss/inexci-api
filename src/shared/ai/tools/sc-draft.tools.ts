import OpenAI from 'openai';
import { In } from 'typeorm';
import { AiTool, ToolContext } from './tool.interface';
import { OperationDraftService } from '../services/operation-draft.service';
import { EntityResolverService } from '../services/entity-resolver.service';
import { PatientRepository } from '../../../database/repositories/patient.repository';
import { ProcedureRepository } from '../../../database/repositories/procedure.repository';
import { HospitalRepository } from '../../../database/repositories/hospital.repository';
import { HealthPlanRepository } from '../../../database/repositories/health-plan.repository';
import { UserRepository } from '../../../database/repositories/user.repository';
import { ActivityType } from '../../../database/entities/surgery-request-activity.entity';
import { SurgeryRequestActivityRepository } from '../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestsService } from '../../../modules/surgery-requests/surgery-requests.service';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { detokenizeArg } from '../pii/tool-pii-helpers';
import { buildToolResult, buildLookupResult } from './tool-result';
import {
  CreateScDraftFields,
  intentToDraftType,
} from '../drafts/operation-draft.types';
import { SurgeryRequestPriority } from '../../../database/entities/surgery-request.entity';
import { formatScProtocolForDisplay } from './protocol.helpers';

const UUID_REGEX = /^[0-9a-f-]{36}$/i;

interface DraftToolDeps {
  draftService: OperationDraftService;
  resolver: EntityResolverService;
  patientRepo: PatientRepository;
  procedureRepo: ProcedureRepository;
  hospitalRepo: HospitalRepository;
  healthPlanRepo: HealthPlanRepository;
  userRepo: UserRepository;
  surgeryRequestRepo: SurgeryRequestRepository;
  surgeryRequestsService: SurgeryRequestsService;
  activityRepo: SurgeryRequestActivityRepository;
}

function normalizeStringArg(context: ToolContext, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(detokenizeArg(context, raw as any) ?? '').trim();
  return text || null;
}

function mapPriority(input: unknown): SurgeryRequestPriority | null {
  if (typeof input === 'number') {
    if (
      input >= SurgeryRequestPriority.LOW &&
      input <= SurgeryRequestPriority.URGENT
    ) {
      return input as SurgeryRequestPriority;
    }
    return null;
  }
  if (typeof input !== 'string') return null;
  const v = input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const map: Record<string, SurgeryRequestPriority> = {
    low: SurgeryRequestPriority.LOW,
    baixa: SurgeryRequestPriority.LOW,
    medium: SurgeryRequestPriority.MEDIUM,
    media: SurgeryRequestPriority.MEDIUM,
    mediana: SurgeryRequestPriority.MEDIUM,
    moderada: SurgeryRequestPriority.MEDIUM,
    high: SurgeryRequestPriority.HIGH,
    alta: SurgeryRequestPriority.HIGH,
    urgent: SurgeryRequestPriority.URGENT,
    urgente: SurgeryRequestPriority.URGENT,
    emergencial: SurgeryRequestPriority.URGENT,
  };
  return map[v] ?? null;
}

function priorityLabel(p: SurgeryRequestPriority | undefined): string {
  if (p === SurgeryRequestPriority.LOW) return 'Baixa';
  if (p === SurgeryRequestPriority.MEDIUM) return 'Média';
  if (p === SurgeryRequestPriority.HIGH) return 'Alta';
  if (p === SurgeryRequestPriority.URGENT) return 'Urgente';
  return 'Não definida';
}

export function buildScDraftTools(deps: DraftToolDeps): AiTool[] {
  const {
    draftService,
    resolver,
    patientRepo,
    procedureRepo,
    hospitalRepo,
    healthPlanRepo,
    userRepo,
    surgeryRequestRepo,
    surgeryRequestsService,
    activityRepo,
  } = deps;

  /**
   * Resolve uma referência (UUID ou nome) contra um repositório owned by
   * owner_id. Retorna o registro encontrado quando há `resolved`; senão
   * devolve um `LookupResult` para o LLM lidar (pedindo desambiguação ou
   * sugerindo cadastro).
   */
  async function resolveByNameOrId<
    T extends { id: string; name?: string | null },
  >(
    repo: {
      findOne: (where: any) => Promise<T | null>;
      findMany: (where: any, skip?: number, take?: number) => Promise<T[]>;
    },
    ownerId: string | null,
    queryRaw: string,
  ): Promise<{ resolved: T | null; lookupJson: string | null }> {
    if (UUID_REGEX.test(queryRaw)) {
      const direct = await repo.findOne({
        id: queryRaw,
        ...(ownerId ? { ownerId } : {}),
      } as any);
      if (direct) return { resolved: direct, lookupJson: null };
      return {
        resolved: null,
        lookupJson: buildLookupResult({
          result: {
            status: 'not_found',
            query: queryRaw,
            candidates: [],
            message: `ID "${queryRaw}" não encontrado.`,
          },
        }),
      };
    }
    const candidates = await repo.findMany(
      (ownerId ? { ownerId } : {}) as any,
      0,
      500,
    );
    const lookup = resolver.resolve<T>({
      query: queryRaw,
      candidates,
      getName: (item) => String((item as any).name ?? ''),
      getId: (item) => item.id,
    });
    if (lookup.status === 'resolved' && lookup.resolved) {
      return { resolved: lookup.resolved.data, lookupJson: null };
    }
    return {
      resolved: null,
      lookupJson: buildLookupResult({
        result: lookup,
        projectData: (c) => ({ id: c.id, name: (c.data as any).name }),
      }),
    };
  }

  const setPatient: AiTool = {
    name: 'sc_draft_set_patient',
    definition: {
      type: 'function',
      function: {
        name: 'sc_draft_set_patient',
        description:
          'Define o paciente do rascunho de SC atual. Aceita nome (resolvido por fuzzy match contra os pacientes acessíveis ao usuário) ou ID UUID. Quando o paciente não existe ou é ambíguo, retorna candidatos para o LLM mostrar ao usuário.',
        parameters: {
          type: 'object',
          properties: {
            patient_name_or_id: {
              type: 'string',
              description: 'Nome (completo ou parcial) ou ID UUID do paciente.',
            },
          },
          required: ['patient_name_or_id'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId)
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      const query = normalizeStringArg(
        context,
        (args as any).patient_name_or_id,
      );
      if (!query) {
        return buildToolResult({
          status: 'needs_input',
          message: 'Informe o nome ou ID do paciente.',
          nextRequiredFields: ['patient_name_or_id'],
        });
      }
      const user = await userRepo.findOne({ id: context.userId } as any);
      const ownerId = user?.ownerId ?? null;
      const { resolved, lookupJson } = await resolveByNameOrId(
        patientRepo as any,
        ownerId,
        query,
      );
      if (lookupJson) return lookupJson;
      if (!resolved) {
        return buildToolResult({
          status: 'needs_input',
          message: `Paciente "${query}" não encontrado.`,
          nextRequiredFields: ['patient_name_or_id'],
        });
      }
      await draftService.setFields(context.conversationId, 'create_sc', {
        patientId: resolved.id,
        patientLabel: (resolved as any).name ?? undefined,
      });
      const validation = await draftService.validate(
        context.conversationId,
        'create_sc',
      );
      return buildToolResult({
        status: validation.isReady ? 'ok' : 'needs_input',
        data: { patientId: resolved.id, patientLabel: (resolved as any).name },
        message: `Paciente definido: ${(resolved as any).name}.`,
        nextRequiredFields: validation.missing,
      });
    },
  };

  const setProcedure: AiTool = {
    name: 'sc_draft_set_procedure',
    definition: {
      type: 'function',
      function: {
        name: 'sc_draft_set_procedure',
        description:
          'Define o procedimento cirúrgico do rascunho de SC. Aceita nome (fuzzy match no catálogo global) ou ID UUID.',
        parameters: {
          type: 'object',
          properties: {
            procedure_name_or_id: {
              type: 'string',
              description:
                'Nome (ex.: "artroplastia total do joelho") ou ID UUID.',
            },
          },
          required: ['procedure_name_or_id'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId)
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      const query = normalizeStringArg(
        context,
        (args as any).procedure_name_or_id,
      );
      if (!query) {
        return buildToolResult({
          status: 'needs_input',
          message: 'Informe o nome ou ID do procedimento.',
          nextRequiredFields: ['procedure_name_or_id'],
        });
      }
      const { resolved, lookupJson } = await resolveByNameOrId(
        procedureRepo as any,
        null,
        query,
      );
      if (lookupJson) return lookupJson;
      if (!resolved) {
        return buildToolResult({
          status: 'needs_input',
          message: `Procedimento "${query}" não encontrado no catálogo.`,
          nextRequiredFields: ['procedure_name_or_id'],
        });
      }
      await draftService.setFields(context.conversationId, 'create_sc', {
        procedureId: resolved.id,
        procedureLabel: (resolved as any).name ?? undefined,
      });
      const validation = await draftService.validate(
        context.conversationId,
        'create_sc',
      );
      return buildToolResult({
        status: validation.isReady ? 'ok' : 'needs_input',
        data: {
          procedureId: resolved.id,
          procedureLabel: (resolved as any).name,
        },
        message: `Procedimento definido: ${(resolved as any).name}.`,
        nextRequiredFields: validation.missing,
      });
    },
  };

  const setHospital: AiTool = {
    name: 'sc_draft_set_hospital',
    definition: {
      type: 'function',
      function: {
        name: 'sc_draft_set_hospital',
        description:
          'Define o hospital do rascunho de SC. Aceita nome (fuzzy), ID UUID ou null para criar SC sem hospital.',
        parameters: {
          type: 'object',
          properties: {
            hospital_name_or_id: {
              type: ['string', 'null'],
              description:
                'Nome ou ID UUID. Passe `null` para criar SC sem hospital.',
            },
          },
          required: ['hospital_name_or_id'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId)
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      const raw = (args as any).hospital_name_or_id;
      if (raw === null) {
        await draftService.setFields(context.conversationId, 'create_sc', {
          hospitalId: null,
          hospitalLabel: null,
        });
        return buildToolResult({
          status: 'ok',
          message: 'Hospital definido como (nenhum).',
        });
      }
      const query = normalizeStringArg(context, raw);
      if (!query) {
        return buildToolResult({
          status: 'needs_input',
          message: 'Informe o nome ou ID do hospital (ou `null`).',
        });
      }
      const user = await userRepo.findOne({ id: context.userId } as any);
      const ownerId = user?.ownerId ?? null;
      const { resolved, lookupJson } = await resolveByNameOrId(
        hospitalRepo as any,
        ownerId,
        query,
      );
      if (lookupJson) return lookupJson;
      if (!resolved) {
        return buildToolResult({
          status: 'needs_input',
          message: `Hospital "${query}" não encontrado.`,
        });
      }
      await draftService.setFields(context.conversationId, 'create_sc', {
        hospitalId: resolved.id,
        hospitalLabel: (resolved as any).name ?? undefined,
      });
      return buildToolResult({
        status: 'ok',
        data: {
          hospitalId: resolved.id,
          hospitalLabel: (resolved as any).name,
        },
        message: `Hospital definido: ${(resolved as any).name}.`,
      });
    },
  };

  const setHealthPlan: AiTool = {
    name: 'sc_draft_set_health_plan',
    definition: {
      type: 'function',
      function: {
        name: 'sc_draft_set_health_plan',
        description:
          'Define o convênio do rascunho de SC. Aceita nome (fuzzy), ID UUID ou null para criar SC sem convênio (particular).',
        parameters: {
          type: 'object',
          properties: {
            health_plan_name_or_id: {
              type: ['string', 'null'],
              description:
                'Nome ou ID UUID. Passe `null` para criar SC sem convênio.',
            },
          },
          required: ['health_plan_name_or_id'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId)
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      const raw = (args as any).health_plan_name_or_id;
      if (raw === null) {
        await draftService.setFields(context.conversationId, 'create_sc', {
          healthPlanId: null,
          healthPlanLabel: null,
        });
        return buildToolResult({
          status: 'ok',
          message: 'Convênio definido como (nenhum) — particular.',
        });
      }
      const query = normalizeStringArg(context, raw);
      if (!query) {
        return buildToolResult({
          status: 'needs_input',
          message: 'Informe o nome ou ID do convênio (ou `null`).',
        });
      }
      const user = await userRepo.findOne({ id: context.userId } as any);
      const ownerId = user?.ownerId ?? null;
      const { resolved, lookupJson } = await resolveByNameOrId(
        healthPlanRepo as any,
        ownerId,
        query,
      );
      if (lookupJson) return lookupJson;
      if (!resolved) {
        return buildToolResult({
          status: 'needs_input',
          message: `Convênio "${query}" não encontrado.`,
        });
      }
      await draftService.setFields(context.conversationId, 'create_sc', {
        healthPlanId: resolved.id,
        healthPlanLabel: (resolved as any).name ?? undefined,
      });
      return buildToolResult({
        status: 'ok',
        data: {
          healthPlanId: resolved.id,
          healthPlanLabel: (resolved as any).name,
        },
        message: `Convênio definido: ${(resolved as any).name}.`,
      });
    },
  };

  const setDoctor: AiTool = {
    name: 'sc_draft_set_doctor',
    definition: {
      type: 'function',
      function: {
        name: 'sc_draft_set_doctor',
        description:
          'Define o médico responsável pela SC no rascunho. Quando o usuário tem acesso a apenas um médico, omita esta tool (será preenchido automaticamente).',
        parameters: {
          type: 'object',
          properties: {
            doctor_name_or_id: {
              type: 'string',
              description: 'Nome (fuzzy) ou ID UUID do médico.',
            },
          },
          required: ['doctor_name_or_id'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId)
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      const query = normalizeStringArg(
        context,
        (args as any).doctor_name_or_id,
      );
      if (!query) {
        return buildToolResult({
          status: 'needs_input',
          message: 'Informe o nome ou ID do médico.',
        });
      }
      const accessibleDoctorIds = context.accessibleDoctorIds || [];
      if (!accessibleDoctorIds.length) {
        return buildToolResult({
          status: 'blocked',
          message: 'Você não tem acesso a nenhum médico.',
        });
      }
      const doctors = await userRepo.findMany(
        { id: In(accessibleDoctorIds) } as any,
        0,
        50,
      );
      const lookup = resolver.resolve({
        query,
        candidates: doctors,
        getName: (d: any) => String(d.name ?? ''),
        getId: (d: any) => String(d.id),
      });
      if (lookup.status !== 'resolved' || !lookup.resolved) {
        return buildLookupResult({
          result: lookup,
          projectData: (c) => ({ id: c.id, name: (c.data as any).name }),
        });
      }
      const doctor = lookup.resolved.data as any;
      await draftService.setFields(context.conversationId, 'create_sc', {
        doctorId: doctor.id,
        doctorLabel: doctor.name ?? undefined,
      });
      return buildToolResult({
        status: 'ok',
        data: { doctorId: doctor.id, doctorLabel: doctor.name },
        message: `Médico definido: ${doctor.name}.`,
      });
    },
  };

  const setPriority: AiTool = {
    name: 'sc_draft_set_priority',
    definition: {
      type: 'function',
      function: {
        name: 'sc_draft_set_priority',
        description:
          'Define a prioridade da SC. Aceita enum (LOW/MEDIUM/HIGH/URGENT) ou pt-BR (baixa/média/alta/urgente).',
        parameters: {
          type: 'object',
          properties: {
            priority: {
              type: ['string', 'number'],
              description: 'Prioridade. Default sugerido pelo usuário: MEDIUM.',
            },
          },
          required: ['priority'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId)
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      const priority = mapPriority((args as any).priority);
      if (!priority) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Prioridade inválida. Use LOW/MEDIUM/HIGH/URGENT ou baixa/média/alta/urgente.',
          nextRequiredFields: ['priority'],
        });
      }
      const priorityKey = priorityToEnumKey(priority);
      await draftService.setFields(context.conversationId, 'create_sc', {
        priority: priorityKey,
      } as Partial<CreateScDraftFields>);
      const validation = await draftService.validate(
        context.conversationId,
        'create_sc',
      );
      return buildToolResult({
        status: validation.isReady ? 'ok' : 'needs_input',
        data: { priority: priorityKey },
        message: `Prioridade definida: ${priorityLabel(priority)}.`,
        nextRequiredFields: validation.missing,
      });
    },
  };

  const setNotes: AiTool = {
    name: 'sc_draft_set_notes',
    definition: {
      type: 'function',
      function: {
        name: 'sc_draft_set_notes',
        description:
          'Registra observações livres no rascunho de SC (opcional).',
        parameters: {
          type: 'object',
          properties: {
            notes: { type: 'string', description: 'Texto livre.' },
          },
          required: ['notes'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId)
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      const notes = normalizeStringArg(context, (args as any).notes);
      await draftService.setFields(context.conversationId, 'create_sc', {
        notes: notes,
      });
      return buildToolResult({
        status: 'ok',
        message: 'Observações registradas no rascunho.',
        data: { notes },
      });
    },
  };

  const status: AiTool = {
    name: 'sc_draft_status',
    definition: {
      type: 'function',
      function: {
        name: 'sc_draft_status',
        description:
          'Retorna o rascunho de SC atual e a lista de campos obrigatórios pendentes.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context: ToolContext): Promise<string> {
      const draft = await draftService.getCurrentOfType(
        context.conversationId,
        'create_sc',
      );
      const validation = await draftService.validate(
        context.conversationId,
        'create_sc',
      );
      return buildToolResult({
        status: draft
          ? validation.isReady
            ? 'ok'
            : 'needs_input'
          : 'needs_input',
        data: draft ? { draft } : null,
        message: draft
          ? validation.isReady
            ? 'Rascunho de SC completo. Use `sc_draft_preview` para mostrar ao usuário antes de commitar.'
            : `Rascunho de SC em andamento. Faltam: ${validation.missing.join(', ')}.`
          : 'Não há rascunho de SC ativo. Chame `plan_actions` com intent="create_sc" primeiro.',
        nextRequiredFields: validation.missing,
      });
    },
  };

  /**
   * Quando o usuário tem acesso a apenas 1 médico, o `doctorId` é dedutível
   * — preenche o draft automaticamente antes de validar.
   */
  async function autoFillDoctorIfSingle(context: ToolContext): Promise<void> {
    const accessible = context.accessibleDoctorIds || [];
    if (accessible.length !== 1) return;
    const current = await draftService.getCurrentOfType(
      context.conversationId,
      'create_sc',
    );
    if (!current || current.fields.doctorId) return;
    const doctor = await userRepo.findOne({ id: accessible[0] } as any);
    await draftService.setFields(context.conversationId, 'create_sc', {
      doctorId: accessible[0],
      doctorLabel: doctor?.name ?? undefined,
    });
  }

  const preview: AiTool = {
    name: 'sc_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'sc_draft_preview',
        description:
          'Gera o preview textual do rascunho de SC para o usuário confirmar. Marca o draft como `pending_confirmation`.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context: ToolContext): Promise<string> {
      await autoFillDoctorIfSingle(context);
      const validation = await draftService.validate(
        context.conversationId,
        'create_sc',
      );
      if (!validation.draft) {
        return buildToolResult({
          status: 'blocked',
          message:
            'Não há rascunho de SC ativo. Chame `plan_actions` com intent="create_sc" primeiro.',
        });
      }
      if (!validation.isReady) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam campos obrigatórios: ${validation.missing.join(', ')}.`,
          nextRequiredFields: validation.missing,
        });
      }
      const { text, draft } = await draftService.getPreview(
        context.conversationId,
        'create_sc',
      );
      return buildToolResult({
        status: 'pending_confirmation',
        message: 'Aguardando confirmação do usuário para criar a SC.',
        displayText: text,
        data: draft ? { draft } : null,
        pendingConfirmation: {
          tool: 'sc_draft_commit',
          args: { confirm: true },
          description: 'Cria a SC com os dados do rascunho atual.',
        },
      });
    },
  };

  const commit: AiTool = {
    name: 'sc_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'sc_draft_commit',
        description:
          'Cria de fato a SC com os dados do rascunho. Só execute após `sc_draft_preview` e confirmação do usuário ("sim").',
        parameters: {
          type: 'object',
          properties: {
            confirm: {
              type: 'boolean',
              description:
                'Precisa ser `true`. Sem isso, devolve apenas o preview.',
            },
          },
          required: ['confirm'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId)
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      if (!(args as any).confirm) {
        return buildToolResult({
          status: 'pending_confirmation',
          message:
            'Para criar a SC, chame esta tool com `confirm=true` após receber confirmação do usuário.',
        });
      }
      await autoFillDoctorIfSingle(context);
      const validation = await draftService.validate(
        context.conversationId,
        'create_sc',
      );
      if (!validation.isReady || !validation.draft) {
        return buildToolResult({
          status: 'blocked',
          message: validation.draft
            ? `Faltam campos obrigatórios: ${validation.missing.join(', ')}.`
            : 'Não há rascunho de SC ativo.',
          nextRequiredFields: validation.missing,
        });
      }

      // Se o draft ainda não tem doctorId mas o usuário tem acesso a apenas
      // um médico, preenchemos automaticamente.
      const fields = validation.draft.fields;
      let doctorId = fields.doctorId;
      if (!doctorId) {
        const accessible = context.accessibleDoctorIds || [];
        if (accessible.length === 1) {
          doctorId = accessible[0];
        } else {
          return buildToolResult({
            status: 'needs_input',
            message:
              'Você tem acesso a múltiplos médicos — informe o médico responsável com `sc_draft_set_doctor`.',
            nextRequiredFields: ['doctorId'],
          });
        }
      }

      try {
        const created = await surgeryRequestsService.createSurgeryRequest(
          {
            doctorId,
            patientId: fields.patientId!,
            procedureId: fields.procedureId!,
            priority: enumKeyToPriority(fields.priority!),
            hospitalId: fields.hospitalId ?? undefined,
            healthPlanId: fields.healthPlanId ?? undefined,
          },
          context.userId,
        );
        await activityRepo.create({
          surgeryRequestId: created.id,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content:
            '[WhatsApp IA] Solicitação criada via rascunho estruturado (sc_draft).',
        });
        const persisted = await surgeryRequestRepo.findOneSimple({
          id: created.id,
        } as any);
        const protocol = formatScProtocolForDisplay(
          persisted?.protocol ?? created.protocol,
        );

        await draftService.finalizeCommit(context.conversationId, {
          id: created.id,
          label: protocol,
        });

        return buildToolResult({
          status: 'ok',
          data: { id: created.id, protocol },
          message: `Solicitação ${protocol} criada com sucesso.`,
          displayText: [
            'Solicitação cirúrgica criada com sucesso!',
            `• Protocolo: ${protocol}`,
            fields.patientLabel ? `• Paciente: ${fields.patientLabel}` : null,
            fields.procedureLabel
              ? `• Procedimento: ${fields.procedureLabel}`
              : null,
            fields.hospitalLabel ? `• Hospital: ${fields.hospitalLabel}` : null,
            fields.healthPlanLabel
              ? `• Convênio: ${fields.healthPlanLabel}`
              : null,
          ]
            .filter(Boolean)
            .join('\n'),
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao criar SC: ${err?.message || 'erro desconhecido'}`,
          errors: [
            { code: 'CREATE_SC_FAILED', message: String(err?.message ?? err) },
          ],
        });
      }
    },
  };

  const cancel: AiTool = {
    name: 'sc_draft_cancel',
    definition: {
      type: 'function',
      function: {
        name: 'sc_draft_cancel',
        description:
          'Cancela o rascunho de SC atual sem criar nada. Use quando o usuário desistir do fluxo.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context: ToolContext): Promise<string> {
      await draftService.cancel(context.conversationId);
      return buildToolResult({
        status: 'ok',
        message: 'Rascunho de SC descartado.',
      });
    },
  };

  return [
    setPatient,
    setProcedure,
    setHospital,
    setHealthPlan,
    setDoctor,
    setPriority,
    setNotes,
    status,
    preview,
    commit,
    cancel,
  ];
}

function priorityToEnumKey(
  p: SurgeryRequestPriority,
): 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' {
  switch (p) {
    case SurgeryRequestPriority.LOW:
      return 'LOW';
    case SurgeryRequestPriority.MEDIUM:
      return 'MEDIUM';
    case SurgeryRequestPriority.HIGH:
      return 'HIGH';
    case SurgeryRequestPriority.URGENT:
      return 'URGENT';
  }
}

function enumKeyToPriority(
  key: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
): SurgeryRequestPriority {
  switch (key) {
    case 'LOW':
      return SurgeryRequestPriority.LOW;
    case 'MEDIUM':
      return SurgeryRequestPriority.MEDIUM;
    case 'HIGH':
      return SurgeryRequestPriority.HIGH;
    case 'URGENT':
      return SurgeryRequestPriority.URGENT;
  }
}

// Stub para suprimir o aviso de `intentToDraftType` não usado em escopo top-level.
void intentToDraftType;
