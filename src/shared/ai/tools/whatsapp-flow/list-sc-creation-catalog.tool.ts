import OpenAI from 'openai';
import { In } from 'typeorm';
import { AiTool } from '../tool.interface';
import { resolveOwnerIdFromContext } from '../catalog.helpers';
import { PiiCategory } from '../../services/pii-vault.service';
import { WhatsappFlowToolDeps } from './_types';
import { asNonEmptyString } from './_helpers';

export function buildListScCreationCatalogTool(
  deps: WhatsappFlowToolDeps,
): AiTool {
  const {
    surgeryRequestsService,
    patientRepo,
    hospitalRepo,
    healthPlanRepo,
    procedureRepo,
    userRepo,
    tussService,
  } = deps;
  return {
    name: 'list_sc_creation_catalog',
    // Lista dinâmica (pacientes, hospitais, convênios, procedimentos podem ser
    // criados durante a sessão). TTL curto (30 s) evita dados obsoletos; o
    // cache é invalidado imediatamente após qualquer draft_commit que altere
    // essas listas.
    cacheable: {
      ttlSeconds: 30,
      invalidatesOn: [
        'sc_draft_commit',
        'patient_draft_commit',
        'hospital_draft_commit',
        'health_plan_draft_commit',
        'procedure_draft_commit',
      ],
    },
    definition: {
      type: 'function',
      function: {
        name: 'list_sc_creation_catalog',
        description:
          'Lista categorias e registros disponíveis para criação de solicitação via WhatsApp. ATENÇÃO: `procedures` (procedimentos cirúrgicos como "Artroscopia de Joelho") e `tuss_codes` (códigos TUSS de faturamento) são categorias DISTINTAS. Para buscar procedimento cirúrgico por nome use a tool dedicada `search_procedures`.',
        parameters: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description:
                'Categoria opcional: patients, procedures (cirúrgicos), tuss_codes (faturamento), health_plans, hospitals, doctors, templates. Se omitido, retorna resumo de todas.',
            },
            limit: {
              type: 'number',
              description: 'Quantidade máxima por categoria (padrão: 20).',
            },
          },
          required: [],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const normalizedCategory = asNonEmptyString(args.category)
        ?.toLowerCase()
        .trim();
      const limit =
        typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? Math.min(Math.max(Math.floor(args.limit), 1), 100)
          : 20;

      const doctorWhere = context.accessibleDoctorIds.length
        ? ({ doctorId: In(context.accessibleDoctorIds) } as any)
        : ({ doctorId: '__none__' } as any);

      const ownerIdForLookup = await resolveOwnerIdFromContext(
        context,
        userRepo,
      );
      const ownerWhere = ownerIdForLookup
        ? ({ ownerId: ownerIdForLookup } as any)
        : ({} as any);

      const [
        patients,
        hospitals,
        healthPlans,
        procedures,
        tussCatalog,
        doctors,
        templates,
      ] = await Promise.all([
        patientRepo
          ? patientRepo.findMany(doctorWhere, 0, limit)
          : Promise.resolve([] as any[]),
        hospitalRepo
          ? hospitalRepo.findMany(ownerWhere, 0, limit)
          : Promise.resolve([] as any[]),
        healthPlanRepo
          ? healthPlanRepo.findMany(ownerWhere, 0, limit)
          : Promise.resolve([] as any[]),
        procedureRepo
          ? procedureRepo.findMany({} as any, 0, limit)
          : Promise.resolve([] as any[]),
        tussService
          ? tussService.search(undefined, limit)
          : Promise.resolve([] as any[]),
        userRepo && context.accessibleDoctorIds.length
          ? userRepo.findMany(
              { id: In(context.accessibleDoctorIds) } as any,
              0,
              limit,
            )
          : Promise.resolve([] as any[]),
        surgeryRequestsService.getTemplates(context.userId as string),
      ]);

      const categoryMap: Record<string, { label: string; items: any[] }> = {
        patients: { label: 'Pacientes', items: patients as any[] },
        procedures: {
          label: 'Procedimentos cirúrgicos',
          items: procedures as any[],
        },
        tuss_codes: {
          label: 'Códigos TUSS (faturamento)',
          items: tussCatalog as any[],
        },
        health_plans: { label: 'Convênios', items: healthPlans as any[] },
        hospitals: { label: 'Hospitais', items: hospitals as any[] },
        doctors: { label: 'Médicos', items: doctors as any[] },
        templates: { label: 'Modelos', items: (templates as any[]) || [] },
      };

      const CATEGORY_TO_PII: Record<string, PiiCategory | null> = {
        patients: 'patient_name',
        hospitals: 'hospital_name',
        health_plans: 'health_plan_name',
        doctors: 'doctor_name',
        procedures: null,
        tuss_codes: null,
        templates: null,
      };

      const formatItems = (
        categoryKey: string,
        label: string,
        items: any[],
      ): string => {
        if (!items.length) return `• ${label}: nenhum cadastrado`;
        const piiCategory = CATEGORY_TO_PII[categoryKey] ?? null;
        const lines = items.slice(0, limit).map((item) => {
          const rawName = item.name || item.title || 'Sem nome';
          if (categoryKey === 'tuss_codes') {
            const tussCode = asNonEmptyString(item.tussCode);
            return tussCode
              ? `  - ${rawName} (Código TUSS: ${tussCode})`
              : `  - ${rawName}`;
          }
          void piiCategory;
          return `  - ${rawName} (id: ${item.id})`;
        });
        return [`• ${label} (${items.length}):`, ...lines].join('\n');
      };

      if (normalizedCategory) {
        const category = categoryMap[normalizedCategory];
        if (!category) {
          return 'Categoria inválida. Use: patients, procedures, tuss_codes, health_plans, hospitals, doctors, templates.';
        }

        return [
          `${category.label} disponíveis para criação da SC:`,
          formatItems(normalizedCategory, category.label, category.items),
        ].join('\n');
      }

      return [
        'Categorias disponíveis para montar sua solicitação:',
        formatItems('patients', 'Pacientes', categoryMap.patients.items),
        formatItems(
          'procedures',
          'Procedimentos cirúrgicos',
          categoryMap.procedures.items,
        ),
        formatItems(
          'tuss_codes',
          'Códigos TUSS (faturamento)',
          categoryMap.tuss_codes.items,
        ),
        formatItems(
          'health_plans',
          'Convênios',
          categoryMap.health_plans.items,
        ),
        formatItems('hospitals', 'Hospitais', categoryMap.hospitals.items),
        formatItems('doctors', 'Médicos', categoryMap.doctors.items),
        formatItems('templates', 'Modelos', categoryMap.templates.items),
        'Procedimento cirúrgico ≠ código TUSS: o primeiro é o tipo da cirurgia (ex.: "Artroscopia de Joelho"); o segundo é faturamento.',
      ].join('\n');
    },
  };
}
