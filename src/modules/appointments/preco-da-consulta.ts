import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { Permission } from 'src/shared/permissions';

export function podeVerPreco(
  user: { permissions?: Permission[] | null } | null | undefined,
): boolean {
  return user?.permissions?.includes(Permission.FINANCEIRO) ?? false;
}

function ehFolha(valor: object): boolean {
  return (
    valor instanceof Date ||
    Buffer.isBuffer(valor) ||
    ArrayBuffer.isView(valor) ||
    valor instanceof ArrayBuffer
  );
}

function removerPreco(valor: unknown, vistos: WeakSet<object>): void {
  if (!valor || typeof valor !== 'object' || ehFolha(valor)) return;
  if (vistos.has(valor)) return;
  vistos.add(valor);
  if (Array.isArray(valor)) {
    valor.forEach((item) => removerPreco(item, vistos));
    return;
  }
  if (valor instanceof Map) {
    valor.forEach((item) => removerPreco(item, vistos));
    return;
  }
  if (valor instanceof Set) {
    valor.forEach((item) => removerPreco(item, vistos));
    return;
  }
  const objeto = valor as Record<string, unknown>;
  if ('price' in objeto) delete objeto.price;
  Object.keys(objeto).forEach((chave) => removerPreco(objeto[chave], vistos));
}

export function ocultarPreco<T>(resposta: T): T {
  removerPreco(resposta, new WeakSet());
  return resposta;
}

@Injectable()
export class OcultarPrecoSemFinanceiroInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { permissions?: Permission[] } }>();
    if (podeVerPreco(request.user)) return next.handle();
    return next.handle().pipe(map((resposta) => ocultarPreco(resposta)));
  }
}
