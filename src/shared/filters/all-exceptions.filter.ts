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
import { PaymentGatewayError } from '../payment-gateway/payment-gateway.interface';

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
    } else if (exception instanceof PaymentGatewayError) {
      status = HttpStatus.BAD_GATEWAY;
      message =
        'Não foi possível falar com o gateway de pagamento. Tente novamente em instantes; se persistir, acione o suporte informando o requestId.';
      extra = { gatewayCode: exception.code };
      this.logger.error(
        `Gateway de pagamento recusou [${exception.code}] em ${request.method} ${request.url}: ${exception.message}`,
        exception.stack,
      );
    } else if (isPayloadTooLargeError(exception)) {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      message = 'Conteúdo muito grande. Reduza o tamanho do texto ou do anexo.';
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

const CAMPOS_RESERVADOS = new Set([
  'statusCode',
  'message',
  'details',
  'requestId',
  'timestamp',
  'path',
  'error',
]);

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
