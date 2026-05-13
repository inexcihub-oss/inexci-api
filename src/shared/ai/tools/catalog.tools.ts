import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { ProcedureRepository } from '../../../database/repositories/procedure.repository';
import { normalizeNameForCompare } from './catalog.helpers';
import { EntityResolverService } from '../services/entity-resolver.service';

/**
 * Tools de catálogo (apenas LEITURA do catálogo global de procedimentos).
 *
 * As tools legacy de criação (`create_hospital`, `create_health_plan`,
 * `create_procedure`) foram removidas em 2026-05-12 (Fase 3.3 do
 * PLANO-OTIMIZACAO-IA-WHATSAPP-EFICIENCIA). A criação desses cadastros agora
 * passa exclusivamente pelo fluxo de drafts:
 *
 *   - `plan_actions(intent="create_hospital")` + `hospital_draft_*`
 *   - `plan_actions(intent="create_health_plan")` + `health_plan_draft_*`
 *   - `plan_actions(intent="create_procedure")` + `procedure_draft_*`
 */
export function buildCatalogTools(
  procedureRepo: ProcedureRepository,
  resolver?: EntityResolverService,
): AiTool[] {
  const entityResolver = resolver ?? new EntityResolverService();

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
            'Se quiser, posso abrir um cadastro novo com `plan_actions(intent="create_procedure")` + `procedure_draft_*` (só o nome é obrigatório).',
          ].join(' ');
        }
        return 'Ainda não há procedimentos cirúrgicos cadastrados no catálogo. Use `plan_actions(intent="create_procedure")` + `procedure_draft_*` para cadastrar o primeiro.';
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

  return [searchProcedures];
}
