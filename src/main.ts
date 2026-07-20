// O ConfigModule do Nest só carrega o `.env` quando o AppModule é
// instanciado (dentro de bootstrap(), mais abaixo) — tarde demais para o
// initOtel(), que precisa rodar ANTES de qualquer módulo Nest para os
// instrumentors se registrarem a tempo. Por isso o dotenv é carregado aqui,
// manualmente, só para preencher o process.env a tempo do initOtel() ler as
// envs OTEL_*. Não sobrescreve variáveis já definidas no ambiente real
// (produção injeta via env_file do Docker, não via arquivo .env).
import { config as loadDotenv } from 'dotenv';
loadDotenv();

import { initOtel } from './shared/observability/otel';
initOtel();

import * as dayjs from 'dayjs';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { NestFactory, Reflector } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import {
  ClassSerializerInterceptor,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as customParse from 'dayjs/plugin/customParseFormat';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { InexciLogger } from './shared/logging/inexci-logger.service';
import { requestContextMiddleware } from './shared/logging/request-context.middleware';

dayjs.extend(customParse);

async function bootstrap() {
  // NOTA: As migrations NÃO são executadas automaticamente.
  // Para rodá-las manualmente: npm run migration:run
  // Para executar seeds, use manualmente: npm run seed
  // Não executamos automaticamente para evitar duplicações em hot reload

  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
    bufferLogs: true,
    rawBody: true,
  });

  // Logger custom — JSON em produção, pretty colorido em dev. Honra LOG_LEVEL
  // e enriquece cada linha com `requestId`/`userId`/`tenantId` do
  // AsyncLocalStorage populado pelo `requestContextMiddleware`.
  app.useLogger(new InexciLogger());

  app.use(requestContextMiddleware);

  // Headers de segurança (V5): HSTS, nosniff, frameguard, remove X-Powered-By.
  // CSP desabilitada — a API responde JSON e a CSP padrão do helmet quebraria o
  // Swagger UI em dev; a CSP relevante já vive no frontend.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Compressão gzip como defesa em profundidade — cobre ambientes sem o nginx
  // na frente (ngrok, dev). Em produção o nginx já comprime (ver nginx/default.conf).
  app.use(compression());

  app.use(cookieParser());

  app.useWebSocketAdapter(new IoAdapter(app));

  // Configurar JSON para não escapar caracteres Unicode
  app.getHttpAdapter().getInstance().set('json escape', false);
  app.getHttpAdapter().getInstance().set('json replacer', null);
  // Pretty-print apenas fora de produção. Em produção a indentação inflaria o
  // payload em ~25–35% e gastaria CPU de serialização sem benefício.
  if (process.env.NODE_ENV !== 'production') {
    app.getHttpAdapter().getInstance().set('json spaces', 2);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  const configService = app.get(ConfigService);

  // BullBoard — bloqueado por padrão; só abre se BULL_BOARD_USER e BULL_BOARD_PASS estiverem definidos
  const bullBoardUser = configService.get<string>('BULL_BOARD_USER', '');
  const bullBoardPass = configService.get<string>('BULL_BOARD_PASS', '');
  if (bullBoardUser && bullBoardPass) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const basicAuth = require('express-basic-auth') as (opts: {
      users: Record<string, string>;
      challenge: boolean;
    }) => (req: unknown, res: unknown, next: () => void) => void;
    app.use(
      '/admin/queues',
      basicAuth({ users: { [bullBoardUser]: bullBoardPass }, challenge: true }),
    );
  } else {
    app.use('/admin/queues', (_req: unknown, res: any) => {
      res.status(404).end();
    });
  }

  // Swagger / OpenAPI — desabilitado em produção
  if (configService.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Inexci API')
      .setDescription(
        'Documentação completa da API Inexci — gestão de solicitações cirúrgicas',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
        filter: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }

  const corsOrigins = configService.get<string>('CORS_ORIGINS');
  const normalizeOrigin = (value: string): string =>
    value.trim().replace(/\/$/, '');

  const allowedOrigins = (corsOrigins ?? '')
    .split(',')
    .map((o) => normalizeOrigin(o))
    .filter(Boolean);

  if (allowedOrigins.length === 0) {
    throw new Error(
      'CORS_ORIGINS não configurado. Defina as origens permitidas via variável de ambiente.',
    );
  }

  app.enableCors({
    origin: (origin, callback) => {
      // Permite requisições sem Origin (curl, healthchecks, server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = normalizeOrigin(origin);

      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      // Bloqueia sem lançar exceção global (evita ruído/500 no ExceptionFilter)
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'ngrok-skip-browser-warning',
      'X-Request-Id',
    ],
    exposedHeaders: ['X-Request-Id'],
  });

  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);

  new Logger('Bootstrap').log(`Aplicação iniciada na porta ${port}`);
}
bootstrap();
