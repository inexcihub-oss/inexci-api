import { AiTool, ANY_AUTHENTICATED, ToolContext } from './tool.interface';
import { TussService, TussResponse } from '../../../modules/tuss/tuss.service';

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function clampLimit(value: unknown, fallback = 10, max = 30): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

function isNumericQuery(query: string): boolean {
  return /\d/.test(query) && /^[\d.\-\s]+$/.test(query.trim());
}

function formatLines(items: TussResponse[]): string[] {
  return items.map((item) => `${item.tussCode} — ${item.name}`);
}

export interface TussToolDeps {
  tussService: TussService;
}

export function buildTussTools({ tussService }: TussToolDeps): AiTool[] {
  const runSearchTussCodes = (
    args: Record<string, unknown>,
    context: ToolContext,
  ): string => {
    if (!context.userId) return 'Acesso negado.';

    const query = asNonEmptyString(args.query);
    if (!query || query.length < 2) {
      return 'Parâmetro inválido: `query` deve ter ao menos 2 caracteres (código completo/parcial ou descrição).';
    }

    const limit = clampLimit(args.limit);

    const numericOnly = isNumericQuery(query);
    if (numericOnly) {
      const exact = tussService.findByExactCode(query);
      if (exact) {
        return [
          `Código TUSS encontrado:`,
          `${exact.tussCode} — ${exact.name}`,
        ].join('\n');
      }
    }

    const results = tussService.lookup(query, limit);
    if (!results.length) {
      return [
        `Nenhum código TUSS encontrado para "${query}".`,
        'Tente refinar usando outro trecho do nome ou parte do código (apenas dígitos).',
      ].join(' ');
    }

    const header = numericOnly
      ? `Códigos TUSS que combinam com "${query}" (${results.length}):`
      : `Códigos TUSS para "${query}" (${results.length}):`;

    return [header, ...formatLines(results)].join('\n');
  };

  const searchTussCodes: AiTool = {
    name: 'search_tuss_codes',
    requiredPermission: ANY_AUTHENTICATED,
    cacheable: { ttlSeconds: 3600 },
    definition: {
      type: 'function',
      function: {
        name: 'search_tuss_codes',
        description:
          'Busca códigos TUSS no catálogo oficial (arquivo estático da Inexci). Use SEMPRE esta tool antes de informar ao usuário um código TUSS ou de chamar `manage_tuss_items` add — JAMAIS invente código ou descrição. Aceita: (a) código completo com máscara (`3.07.15.01-6`) ou só dígitos (`30715016`), (b) parte do código (`3071`), (c) descrição completa (`Artroscopia de joelho`) ou (d) parte da descrição (`joelho`, `artroscopia sinovectomia`). O retorno é ordenado por relevância (match exato → prefixo → substring).',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Termo de busca: código (completo/parcial, com ou sem máscara) ou descrição (completa/parcial). Mínimo 2 caracteres.',
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
    },
    execute(args, context: ToolContext): Promise<string> {
      return new Promise<string>((resolve) =>
        resolve(runSearchTussCodes(args, context)),
      );
    },
  };

  return [searchTussCodes];
}
