import { buildToolResult } from '../tool-result';
import { ToolContext } from '../tool.interface';
import { translateServiceError } from './service-error-translator';

export interface DelegateToServiceOpts<TDto, TResult> {
  toolName: string;

  context: ToolContext;

  args: Record<string, unknown>;

  buildDto: () => Promise<TDto>;

  validate?: (dto: TDto) => Promise<string[] | null>;

  buildPreview: (dto: TDto) => string;

  call: (dto: TDto, userId: string) => Promise<TResult>;

  formatSuccess: (result: TResult, ctx: ToolContext) => string;
}

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
