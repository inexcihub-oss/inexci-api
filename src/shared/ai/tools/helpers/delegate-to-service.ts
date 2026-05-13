import { buildToolResult } from '../tool-result';
import { ToolContext } from '../tool.interface';
import { translateServiceError } from './service-error-translator';

export interface DelegateToServiceOpts<TDto, TResult> {
  /**
   * Nome da tool (usado em logs).
   */
  toolName: string;

  /**
   * Contexto da tool (usuário autenticado, conversa, etc.).
   */
  context: ToolContext;

  /**
   * Argumentos brutos recebidos da tool (usados para checar `confirm`).
   */
  args: Record<string, unknown>;

  /**
   * Factory que constrói o DTO a partir dos campos do draft / args.
   * Deve lançar `Error` com mensagem amigável se a construção falhar.
   */
  buildDto: () => Promise<TDto>;

  /**
   * Validação extra opcional. Retorna lista de erros (string[]) ou `null`
   * quando não há erros. Será chamado após `buildDto`.
   */
  validate?: (dto: TDto) => Promise<string[] | null>;

  /**
   * Gera o texto de preview que será exibido ao usuário antes da confirmação.
   */
  buildPreview: (dto: TDto) => string;

  /**
   * Chama o Service com o DTO validado. Recebe também o `userId` do contexto.
   */
  call: (dto: TDto, userId: string) => Promise<TResult>;

  /**
   * Formata a mensagem de sucesso a partir do resultado do Service.
   */
  formatSuccess: (result: TResult, ctx: ToolContext) => string;
}

/**
 * Helper canônico que implementa o padrão preview/confirm de delegação a um
 * Service NestJS. Toda tool de mutação deveria usar este helper para:
 *
 *  1. Validar autenticação.
 *  2. Construir e validar o DTO.
 *  3. Retornar preview quando `confirm !== true`.
 *  4. Chamar o Service e traduzir erros HTTP em mensagens amigáveis ao LLM.
 *
 * Com isso, cada tool de mutação cai de 80–150 linhas para 20–40 linhas.
 *
 * @example
 * ```typescript
 * return delegateToService({
 *   toolName: 'hospital_draft_commit',
 *   context,
 *   args,
 *   buildDto: async () => ({ name: fields.name }),
 *   buildPreview: (dto) => `Criar hospital: ${dto.name}`,
 *   call: (dto, userId) => hospitalsService.create(dto, userId),
 *   formatSuccess: (r) => `Hospital "${r.name}" criado com sucesso.`,
 * });
 * ```
 */
export async function delegateToService<TDto, TResult>(
  opts: DelegateToServiceOpts<TDto, TResult>,
): Promise<string> {
  if (!opts.context.userId) {
    return buildToolResult({ status: 'error', message: 'Acesso negado.' });
  }

  let dto: TDto;
  try {
    dto = await opts.buildDto();
  } catch (err: unknown) {
    return buildToolResult({
      status: 'blocked',
      message: translateServiceError(err),
    });
  }

  if (opts.validate) {
    const errors = await opts.validate(dto);
    if (errors?.length) {
      return buildToolResult({
        status: 'blocked',
        message: errors.join('\n'),
      });
    }
  }

  if (opts.args['confirm'] !== true) {
    return buildToolResult({
      status: 'pending_confirmation',
      displayText: opts.buildPreview(dto),
    });
  }

  try {
    const result = await opts.call(dto, opts.context.userId);
    return buildToolResult({
      status: 'ok',
      displayText: opts.formatSuccess(result, opts.context),
    });
  } catch (err: unknown) {
    return buildToolResult({
      status: 'error',
      message: translateServiceError(err),
    });
  }
}
