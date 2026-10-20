import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request } from 'express';

const METODOS_COM_CORPO = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const JSON_OBRIGATORIO_MENSAGEM =
  'Envie o corpo da requisição como application/json.';

function temCorpo(req: Request): boolean {
  const tamanho = Number(req.headers['content-length'] ?? 0);
  return (
    (Number.isFinite(tamanho) && tamanho > 0) ||
    req.headers['transfer-encoding'] !== undefined
  );
}

export function ehJson(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return mime === 'application/json';
}

@Injectable()
export class JsonOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!METODOS_COM_CORPO.has(req.method.toUpperCase())) return true;

    const contentType = req.headers['content-type'];
    if (!contentType && !temCorpo(req)) return true;
    if (ehJson(contentType)) return true;

    throw new UnsupportedMediaTypeException(JSON_OBRIGATORIO_MENSAGEM);
  }
}
