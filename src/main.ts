import { config as loadDotenv } from 'dotenv';
loadDotenv();

import { initOtel } from './shared/observability/otel';
initOtel();

import * as dayjs from 'dayjs';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as customParse from 'dayjs/plugin/customParseFormat';
import { applyGlobalAppConfig } from './shared/bootstrap/global-app-config';
import { InexciLogger } from './shared/logging/inexci-logger.service';
import { requestContextMiddleware } from './shared/logging/request-context.middleware';

dayjs.extend(customParse);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: true,
    bufferLogs: true,
    rawBody: true,
  });

  app.set('trust proxy', 1);

  app.useLogger(new InexciLogger());

  app.use(requestContextMiddleware);

  app.use(helmet({ contentSecurityPolicy: false }));

  app.use(compression());

  app.use(cookieParser());

  app.useWebSocketAdapter(new IoAdapter(app));

  app.getHttpAdapter().getInstance().set('json escape', false);
  app.getHttpAdapter().getInstance().set('json replacer', null);
  if (process.env.NODE_ENV !== 'production') {
    app.getHttpAdapter().getInstance().set('json spaces', 2);
  }

  applyGlobalAppConfig(app);

  const configService = app.get(ConfigService);

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
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = normalizeOrigin(origin);

      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

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
