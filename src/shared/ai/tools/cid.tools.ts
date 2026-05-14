import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import {
  CidService,
  CidResponse,
} from '../../../modules/surgery-requests/cid/cid.service';

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function clampLimit(value: unknown, fallback = 10, max = 30): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

/**
 * Heurística leve para decidir se a query parece um CID-10 (ex.: "M17", "M17.1",
 * "M171"). CIDs sempre começam com letra seguida de dígitos. Usado apenas
 * para escolher entre `findByExactCode` e `lookup` — em qualquer caso, a tool
 * cai para `lookup` quando não há match exato.
 */
function looksLikeCidCode(query: string): boolean {
  const cleaned = query.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]\d{1,4}$/.test(cleaned);
}

function formatLines(items: CidResponse[]): string[] {
  return items.map((item) => `${item.code} — ${item.description}`);
}

/**
 * Tools de catálogo CID-10 (lookup somente — não há mutação aqui).
 *
 * O catálogo é um arquivo estático (`src/utils/cid.json`). A IA usa esta tool
 * quando o usuário menciona um código CID, seja por:
 *   - código completo (com ou sem ponto: `M17`, `M17.1`, `M171`);
 *   - parte do código (`M17`, `M1`);
 *   - descrição completa (ex.: "Artrose primária bilateral do joelho");
 *   - parte da descrição (ex.: "joelho", "artrose").
 *
 * O CID é OPCIONAL na SC — a tool serve só para ajudar a IA a confirmar
 * código + descrição quando o usuário traz um deles.
 */
export function buildCidTools(cidService: CidService): AiTool[] {
  const searchCidCodes: AiTool = {
    name: 'search_cid_codes',
    // Catálogo CID-10 é um arquivo estático — nunca muda em runtime.
    // TTL 1 h elimina lookups redundantes (ex.: mesmo CID consultado
    // duas vezes na mesma conversa ou em conversas próximas).
    cacheable: { ttlSeconds: 3600 },
    definition: {
      type: 'function',
      function: {
        name: 'search_cid_codes',
        description:
          'Busca códigos CID-10 no catálogo oficial (arquivo estático da Inexci). Use SEMPRE esta tool antes de informar ao usuário um código CID — JAMAIS invente código ou descrição. Aceita: (a) código completo com ou sem ponto (`M17.1` ou `M171`), (b) parte do código (`M17`, `M1`), (c) descrição completa (`Artrose primária bilateral do joelho`) ou (d) parte da descrição (`joelho`, `artrose joelho`). O retorno é ordenado por relevância (match exato → prefixo → substring). CID é opcional na SC.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Termo de busca: código CID (completo/parcial, com ou sem ponto) ou descrição (completa/parcial). Mínimo 2 caracteres.',
            },
            limit: {
              type: 'number',
              description:
                'Quantidade máxima de resultados (1 a 30, padrão 10).',
            },
          },
          required: ['query'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const query = asNonEmptyString(args.query);
      if (!query || query.length < 2) {
        return 'Parâmetro inválido: `query` deve ter ao menos 2 caracteres (código completo/parcial ou descrição).';
      }

      const limit = clampLimit(args.limit);

      // Quando a query parece um CID completo, tenta match exato primeiro.
      // Isso garante que o LLM receba apenas 1 linha quando o usuário forneceu
      // um código válido (caso comum de "qual a descrição do M17.1?").
      const codeLike = looksLikeCidCode(query);
      if (codeLike) {
        const exact = cidService.findByExactCode(query);
        if (exact) {
          return [
            `Código CID encontrado:`,
            `${exact.code} — ${exact.description}`,
          ].join('\n');
        }
      }

      const results = cidService.lookup(query, limit);
      if (!results.length) {
        return [
          `Nenhum CID encontrado para "${query}".`,
          'Tente outro trecho da descrição ou verifique a grafia do código.',
        ].join(' ');
      }

      const header = codeLike
        ? `Códigos CID que combinam com "${query}" (${results.length}):`
        : `Códigos CID para "${query}" (${results.length}):`;

      return [header, ...formatLines(results)].join('\n');
    },
  };

  return [searchCidCodes];
}
