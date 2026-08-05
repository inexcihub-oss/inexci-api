import OpenAI from 'openai';
import { In } from 'typeorm';
import { AiTool } from '../tool.interface';
import { Permission } from 'src/shared/permissions';
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
    // NÃO cacheable: a categoria `templates` é omitida para quem não tem
    // Permission.SOLICITACOES (ver `hasSolicitacoes` abaixo), mas a chave de
    // cache do `ToolExecutorService` (`buildCacheKey`) só considera
    // `ownerId` + args — não o `context.permissions` do chamador. Cachear
    // aqui deixaria a resposta de um usuário (com ou sem a permissão)
    // vazar/sumir para outro usuário do mesmo owner dentro do TTL. As demais
    // categorias (pacientes, hospitais, convênios, procedimentos, TUSS,
    // médicos) não têm esse problema, mas a tool inteira perde o cache por
    // simplicidade — é uma listagem leve, sem N+1.
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

      // `templates` é modelo de solicitação cirúrgica — dado da área
      // Solicitações, não catálogo neutro (o próprio `GET
      // /surgery-requests/templates` herda `@RequirePermission(SOLICITACOES)`
      // de classe no HTTP). As outras seis categorias continuam livres.
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
        hasSolicitacoes
          ? surgeryRequestsService.getTemplates(
              context.userId as string,
              ownerIdForLookup,
            )
          : Promise.resolve([] as any[]),
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
        // `templates` fica de fora do resumo geral para quem não tem
        // Permission.SOLICITACOES — ver comentário no topo do `execute`.
        ...(hasSolicitacoes
          ? [formatItems('templates', 'Modelos', categoryMap.templates.items)]
          : []),
        'Procedimento cirúrgico ≠ código TUSS: o primeiro é o tipo da cirurgia (ex.: "Artroscopia de Joelho"); o segundo é faturamento.',
      ].join('\n');
    },
  };
}
