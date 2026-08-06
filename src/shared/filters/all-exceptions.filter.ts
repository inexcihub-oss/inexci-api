import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { QueryFailedError, EntityNotFoundError } from 'typeorm';
import { Response, Request } from 'express';
import { getRequestContext } from '../logging/request-context';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Erro interno do servidor';
    let details: any = undefined;
    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();
      if (typeof exResponse === 'string') {
        message = exResponse;
      } else if (typeof exResponse === 'object' && exResponse !== null) {
        const res = exResponse as Record<string, unknown>;
        message = (res.message as string | string[]) || message;
        details = res.details;
        extra = pickExtraFields(res);
      }
    } else if (exception instanceof QueryFailedError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Erro na operação do banco de dados';
      this.logger.error(`DB Error: ${exception.message}`, exception.stack);
    } else if (exception instanceof EntityNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      message = 'Recurso não encontrado';
    } else if (isPayloadTooLargeError(exception)) {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      message = 'Conteúdo muito grande. Reduza o tamanho do texto ou do anexo.';
      // `warn`, não `error`: o corpo excedeu o limite configurado — é entrada
      // do cliente, não falha da aplicação, e não deve poluir o alerta de
      // exceções não tratadas.
      this.logger.warn(`Payload too large: ${request.method} ${request.url}`);
    } else {
      this.logger.error(
        `Unhandled exception: ${exception}`,
        (exception as Error)?.stack,
      );
    }

    const requestId = getRequestContext()?.requestId ?? null;

    response.status(status).json({
      ...extra,
      statusCode: status,
      message,
      ...(details && { details }),
      ...(requestId && { requestId }),
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}

/**
 * Corpo maior que o limite do `body-parser` (100kb por padrão).
 *
 * O erro vem do `raw-body`/`body-parser`, que é anterior ao Nest no pipeline:
 * não é `HttpException` e caía no `else` genérico, virando um 500 "Erro
 * interno do servidor" com stack de "Unhandled exception" — o cliente não
 * ficava sabendo que o problema era o tamanho do que ele mandou.
 *
 * A identificação é por `type: 'entity.too.large'` (a marca do `raw-body`) com
 * o `statusCode`/`status` 413 como rede de segurança para outras camadas que
 * lancem o mesmo erro do `http-errors` sem o `type`.
 */
function isPayloadTooLargeError(exception: unknown): boolean {
  if (typeof exception !== 'object' || exception === null) return false;
  const erro = exception as {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  return (
    erro.type === 'entity.too.large' ||
    erro.status === HttpStatus.PAYLOAD_TOO_LARGE ||
    erro.statusCode === HttpStatus.PAYLOAD_TOO_LARGE
  );
}

/**
 * Campos que o filtro reconstrói por conta própria — replicá-los a partir do
 * corpo da exceção só criaria divergência.
 */
const CAMPOS_RESERVADOS = new Set([
  'statusCode',
  'message',
  'details',
  'requestId',
  'timestamp',
  'path',
  'error',
]);

/**
 * Preserva as chaves extras que a exceção declarou (`reason` do
 * `BillingRequiredException`, `pendencies[]` dos bloqueios de transição).
 *
 * Antes o filtro montava a resposta do zero e só repassava `message`/`details`,
 * o que apagava esses campos no caminho: o frontend recebia um 402/400 sem o
 * motivo e só conseguia exibir um erro genérico. A propagação é aditiva — os
 * campos reservados acima continuam vindo do próprio filtro.
 */
function pickExtraFields(
  res: Record<string, unknown>,
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(res)) {
    if (CAMPOS_RESERVADOS.has(chave)) continue;
    if (valor === undefined) continue;
    extra[chave] = valor;
  }
  return extra;
}
