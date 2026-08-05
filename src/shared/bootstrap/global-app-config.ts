import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';

/**
 * Pipe, filtro e interceptor globais da aplicação.
 *
 * Ponto único de configuração: `main.ts` e o `createTestApp` dos e2e chamam
 * esta função. Quando os e2e montavam o app por conta própria, registravam só
 * o `ValidationPipe` — um `QueryFailedError` que a aplicação real devolve como
 * 400 aparecia como 500 nos testes, e campos removidos pelo serializer
 * continuavam no corpo. Testar um app diferente do que roda em produção foi o
 * defeito D-13.
 */
export function applyGlobalAppConfig(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
}
