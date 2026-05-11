import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { HospitalRepository } from '../../../database/repositories/hospital.repository';
import { HealthPlanRepository } from '../../../database/repositories/health-plan.repository';
import { ProcedureRepository } from '../../../database/repositories/procedure.repository';
import { UserRepository } from '../../../database/repositories/user.repository';
import {
  findOwnedByNormalizedName,
  normalizeNameForCompare,
  resolveOwnerIdFromContext,
} from './catalog.helpers';
import { tokenizePii } from '../pii/tool-pii-helpers';
import { EntityResolverService } from '../services/entity-resolver.service';

function asTrimmedName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  if (trimmed.length > 150) return null;
  if (trimmed.length < 2) return null;
  return trimmed;
}

/**
 * Tools de catálogo (hospital, convênio, procedimento) usadas pela IA durante
 * a criação de uma SC quando o usuário menciona um registro que não existe
 * ainda. Todas seguem o mesmo contrato:
 *
 *   - `name` é o único campo obrigatório (validação curta);
 *   - `confirm: false` (ou omitido) devolve apenas um preview;
 *   - `confirm: true` cria de fato;
 *   - duplicatas são detectadas por nome normalizado dentro do mesmo
 *     `ownerId` (clínica) — exceto procedimentos, que são catálogo global.
 */
export function buildCatalogTools(
  hospitalRepo: HospitalRepository,
  healthPlanRepo: HealthPlanRepository,
  procedureRepo: ProcedureRepository,
  userRepo: UserRepository,
  resolver?: EntityResolverService,
): AiTool[] {
  const entityResolver = resolver ?? new EntityResolverService();
  const createHospital: AiTool = {
    name: 'create_hospital',
    definition: {
      type: 'function',
      function: {
        name: 'create_hospital',
        description:
          'Cadastra um novo hospital na clínica do usuário. Use quando o usuário tentar usar um hospital que ainda não existe (a tool de SC vai indicar isso). Único campo obrigatório: `name`. Sem `confirm=true`, devolve apenas um preview — NUNCA cria sem confirmação explícita do usuário.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'Nome do hospital (mínimo 2 caracteres, máximo 150). Único campo obrigatório.',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa o cadastro. Se false ou omitido, mostra preview e pede confirmação.',
            },
          },
          required: ['name'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';
      const TOOL = 'create_hospital';

      const name = asTrimmedName(args.name);
      if (!name) {
        return 'Parâmetro inválido: `name` é obrigatório (2 a 150 caracteres).';
      }

      const ownerId = await resolveOwnerIdFromContext(context, userRepo);
      if (!ownerId) {
        return 'Não foi possível identificar a clínica do usuário para cadastrar o hospital.';
      }

      const existing = await findOwnedByNormalizedName(
        hospitalRepo as any,
        name,
        ownerId,
      );
      if (existing) {
        const existingToken = tokenizePii(
          context,
          TOOL,
          'hospital_name',
          existing.name,
        );
        return `Já existe um hospital cadastrado nesta clínica com nome equivalente: ${existingToken}. Use esse cadastro para vincular à SC.`;
      }

      if (!args.confirm) {
        const previewToken = tokenizePii(context, TOOL, 'hospital_name', name);
        return [
          'Confirme o cadastro do hospital:',
          `Nome: ${previewToken}`,
          '',
          'Responda "sim" para confirmar e cadastrar.',
        ].join('\n');
      }

      try {
        const created = await hospitalRepo.create({
          ownerId,
          name,
          active: true,
        } as any);
        const createdToken = tokenizePii(
          context,
          TOOL,
          'hospital_name',
          created.name,
        );
        return [
          `Hospital ${createdToken} cadastrado com sucesso.`,
          'Posso continuar a criação da SC com ele agora?',
        ].join('\n');
      } catch (err: any) {
        return `Erro ao cadastrar hospital: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const createHealthPlan: AiTool = {
    name: 'create_health_plan',
    definition: {
      type: 'function',
      function: {
        name: 'create_health_plan',
        description:
          'Cadastra um novo convênio (plano de saúde) na clínica do usuário. Use quando o usuário tentar usar um convênio que ainda não existe. Único campo obrigatório: `name`. Sem `confirm=true`, devolve apenas um preview — NUNCA cria sem confirmação explícita do usuário.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'Nome do convênio (mínimo 2 caracteres, máximo 150). Único campo obrigatório.',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa o cadastro. Se false ou omitido, mostra preview e pede confirmação.',
            },
          },
          required: ['name'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';
      const TOOL = 'create_health_plan';

      const name = asTrimmedName(args.name);
      if (!name) {
        return 'Parâmetro inválido: `name` é obrigatório (2 a 150 caracteres).';
      }

      const ownerId = await resolveOwnerIdFromContext(context, userRepo);
      if (!ownerId) {
        return 'Não foi possível identificar a clínica do usuário para cadastrar o convênio.';
      }

      const existing = await findOwnedByNormalizedName(
        healthPlanRepo as any,
        name,
        ownerId,
      );
      if (existing) {
        const existingToken = tokenizePii(
          context,
          TOOL,
          'health_plan_name',
          existing.name,
        );
        return `Já existe um convênio cadastrado nesta clínica com nome equivalente: ${existingToken}. Use esse cadastro para vincular à SC.`;
      }

      if (!args.confirm) {
        const previewToken = tokenizePii(
          context,
          TOOL,
          'health_plan_name',
          name,
        );
        return [
          'Confirme o cadastro do convênio:',
          `Nome: ${previewToken}`,
          '',
          'Responda "sim" para confirmar e cadastrar.',
        ].join('\n');
      }

      try {
        const created = await healthPlanRepo.create({
          ownerId,
          name,
          active: true,
        } as any);
        const createdToken = tokenizePii(
          context,
          TOOL,
          'health_plan_name',
          created.name,
        );
        return [
          `Convênio ${createdToken} cadastrado com sucesso.`,
          'Posso continuar a criação da SC com ele agora?',
        ].join('\n');
      } catch (err: any) {
        return `Erro ao cadastrar convênio: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const createProcedure: AiTool = {
    name: 'create_procedure',
    definition: {
      type: 'function',
      function: {
        name: 'create_procedure',
        description:
          'Cadastra um novo procedimento no catálogo global da Inexci. Use quando o procedimento mencionado pelo usuário não estiver cadastrado e ele quiser criar antes de prosseguir com a SC. Único campo obrigatório: `name`. Sem `confirm=true`, devolve apenas um preview — NUNCA cria sem confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'Nome do procedimento (ex.: "Artroscopia de Joelho"). Mínimo 2 caracteres, máximo 255.',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa o cadastro. Se false ou omitido, mostra preview e pede confirmação.',
            },
          },
          required: ['name'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const rawName =
        typeof args.name === 'string'
          ? args.name.trim().replace(/\s+/g, ' ')
          : '';
      if (!rawName || rawName.length < 2 || rawName.length > 255) {
        return 'Parâmetro inválido: `name` é obrigatório (2 a 255 caracteres).';
      }

      const target = normalizeNameForCompare(rawName);

      // Catálogo global de procedimentos: tenta match exato primeiro,
      // depois pesquisa uma janela e compara normalizado para evitar
      // duplicar "Artroscopia de Joelho" / "artroscopia de joelho".
      let existing = await procedureRepo.findOne({ name: rawName } as any);
      if (!existing) {
        const candidates = await procedureRepo.findMany({} as any, 0, 200);
        existing =
          candidates.find(
            (item) => normalizeNameForCompare(item.name) === target,
          ) ?? null;
      }
      if (existing) {
        return `Já existe um procedimento cadastrado com nome equivalente: "${existing.name}" (id: ${existing.id}). Posso usar esse na sua SC?`;
      }

      if (!args.confirm) {
        return [
          'Confirme o cadastro do procedimento:',
          `Nome: ${rawName}`,
          '',
          'Responda "sim" para confirmar e cadastrar.',
        ].join('\n');
      }

      try {
        const created = await procedureRepo.create({ name: rawName } as any);
        return [
          `Procedimento "${created.name}" cadastrado com sucesso.`,
          'Posso continuar a criação da SC com ele agora?',
        ].join('\n');
      } catch (err: any) {
        return `Erro ao cadastrar procedimento: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const searchProcedures: AiTool = {
    name: 'search_procedures',
    definition: {
      type: 'function',
      function: {
        name: 'search_procedures',
        description:
          'Lista o catálogo de PROCEDIMENTOS CIRÚRGICOS (tabela `procedures`) usados como procedimento PRINCIPAL de uma SC. NÃO confundir com códigos TUSS (`manage_tuss_items`) — TUSS é faturamento, procedimento cirúrgico é o tipo da cirurgia (ex.: "Artroscopia de Joelho", "Cirurgia do Joelho"). Use SEMPRE esta tool antes de dizer ao usuário que um procedimento "não existe" ou "não há procedimentos do tipo X". Aceita filtro opcional `query` por trecho do nome (acento e caixa ignorados).',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Trecho do nome para filtrar (ex.: "joelho"). Opcional — se omitido, devolve os primeiros itens do catálogo.',
            },
            limit: {
              type: 'number',
              description:
                'Quantidade máxima de resultados (1 a 50, padrão 15).',
            },
          },
          required: [],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const queryRaw = typeof args.query === 'string' ? args.query.trim() : '';
      const limit = Math.min(
        Math.max(
          typeof args.limit === 'number' ? Math.floor(args.limit) : 15,
          1,
        ),
        50,
      );

      const all = await procedureRepo.findMany({} as any, 0, 500);
      let candidates = all;
      let usedFuzzy = false;
      if (queryRaw) {
        const target = normalizeNameForCompare(queryRaw);
        const substringMatches = all.filter((item) => {
          const itemName = normalizeNameForCompare(item.name);
          return !!itemName && itemName.includes(target);
        });
        if (substringMatches.length > 0) {
          candidates = substringMatches;
        } else {
          // Fallback fuzzy: tolera typos / erros de transcrição
          // (ex.: "artoplastia" -> "artroplastia").
          const result = entityResolver.resolve<any>({
            query: queryRaw,
            candidates: all,
            getName: (p: any) => String(p.name ?? ''),
            getId: (p: any) => String(p.id),
            candidateThreshold: 0.55,
            maxCandidates: limit,
          });
          if (result.status === 'resolved' && result.resolved) {
            candidates = [
              result.resolved.data,
              ...result.candidates.map((c) => c.data),
            ];
            usedFuzzy = true;
          } else if (result.status === 'ambiguous') {
            candidates = result.candidates.map((c) => c.data);
            usedFuzzy = true;
          } else {
            candidates = [];
          }
        }
      }

      if (!candidates.length) {
        if (queryRaw) {
          return [
            `Não encontrei procedimentos cirúrgicos no catálogo parecidos com "${queryRaw}".`,
            'Se quiser, posso cadastrar um novo procedimento com `create_procedure` (só o nome é obrigatório).',
          ].join(' ');
        }
        return 'Ainda não há procedimentos cirúrgicos cadastrados no catálogo. Use `create_procedure` para cadastrar o primeiro.';
      }

      const slice = candidates.slice(0, limit);
      const lines = slice.map((p: any) => `- ${p.name} (id: ${p.id})`);

      const total = candidates.length;
      const headerVerb = usedFuzzy ? 'se parecem com' : 'contêm';
      const header = queryRaw
        ? `Procedimentos cirúrgicos do catálogo que ${headerVerb} "${queryRaw}" (${slice.length} de ${total}):`
        : `Procedimentos cirúrgicos do catálogo (${slice.length} de ${total}):`;

      return [header, ...lines].join('\n');
    },
  };

  return [createHospital, createHealthPlan, createProcedure, searchProcedures];
}
