import { In } from 'typeorm';
import { AiTool } from '../tool.interface';
import { ALL_PERMISSIONS, Permission } from 'src/shared/permissions';
import { resolveOwnerIdFromContext } from '../catalog.helpers';
import { WhatsappFlowToolDeps } from './_types';
import { asNonEmptyString } from '../helpers/arg-parsers';

interface CatalogItem {
  id?: string;
  name?: string | null;
  title?: string | null;
  tussCode?: string | null;
}

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
    requiredPermission: ALL_PERMISSIONS,
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
    },
    async execute(args, context): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const hasSolicitacoes = (context.permissions ?? []).includes(
        Permission.SOLICITACOES,
      );

      const normalizedCategory = asNonEmptyString(args.category)
        ?.toLowerCase()
        .trim();

      if (normalizedCategory === 'templates' && !hasSolicitacoes) {
        return 'Você não tem acesso aos modelos de solicitação. Fale com o administrador da sua clínica.';
      }

      const limit =
        typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? Math.min(Math.max(Math.floor(args.limit), 1), 100)
          : 20;

      const doctorWhere = {
        doctorId: context.accessibleDoctorIds.length
          ? In(context.accessibleDoctorIds)
          : '__none__',
      };

      const ownerIdForLookup = await resolveOwnerIdFromContext(
        context,
        userRepo,
      );
      const ownerWhere = ownerIdForLookup ? { ownerId: ownerIdForLookup } : {};

      const [patients, hospitals, healthPlans, procedures, doctors, templates] =
        await Promise.all([
          patientRepo.findMany(doctorWhere, 0, limit),
          hospitalRepo.findMany(ownerWhere, 0, limit),
          healthPlanRepo.findMany(ownerWhere, 0, limit),
          procedureRepo.findMany({}, 0, limit),
          context.accessibleDoctorIds.length
            ? userRepo.findMany(
                { id: In(context.accessibleDoctorIds) },
                0,
                limit,
              )
            : Promise.resolve([]),
          hasSolicitacoes
            ? surgeryRequestsService.getTemplates(
                context.userId,
                ownerIdForLookup,
              )
            : Promise.resolve([]),
        ]);
      const tussCatalog = tussService.search(undefined, limit);

      const categoryMap: Record<
        string,
        { label: string; items: CatalogItem[] }
      > = {
        patients: { label: 'Pacientes', items: patients },
        procedures: {
          label: 'Procedimentos cirúrgicos',
          items: procedures,
        },
        tuss_codes: {
          label: 'Códigos TUSS (faturamento)',
          items: tussCatalog,
        },
        health_plans: { label: 'Convênios', items: healthPlans },
        hospitals: { label: 'Hospitais', items: hospitals },
        doctors: { label: 'Médicos', items: doctors },
        templates: { label: 'Modelos', items: templates ?? [] },
      };

      const formatItems = (
        categoryKey: string,
        label: string,
        items: CatalogItem[],
      ): string => {
        if (!items.length) return `• ${label}: nenhum cadastrado`;
        const lines = items.slice(0, limit).map((item) => {
          const rawName = item.name || item.title || 'Sem nome';
          if (categoryKey === 'tuss_codes') {
            const tussCode = asNonEmptyString(item.tussCode);
            return tussCode
              ? `  - ${rawName} (Código TUSS: ${tussCode})`
              : `  - ${rawName}`;
          }
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
        ...(hasSolicitacoes
          ? [formatItems('templates', 'Modelos', categoryMap.templates.items)]
          : []),
        'Procedimento cirúrgico ≠ código TUSS: o primeiro é o tipo da cirurgia (ex.: "Artroscopia de Joelho"); o segundo é faturamento.',
      ].join('\n');
    },
  };
}
