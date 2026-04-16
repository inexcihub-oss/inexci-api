import * as dayjs from 'dayjs';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { NestFactory, Reflector } from '@nestjs/core';
import {
  ClassSerializerInterceptor,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as customParse from 'dayjs/plugin/customParseFormat';
import dataSource from './database/typeorm/data-source';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';

dayjs.extend(customParse);

const logger = new Logger('Bootstrap');

async function bootstrap() {
  // Executar migrations automaticamente
  try {
    await dataSource.initialize();
    logger.log('Executando migrations...');
    const migrations = await dataSource.runMigrations();
    if (migrations.length > 0) {
      logger.log(`${migrations.length} migration(s) executada(s) com sucesso`);
      migrations.forEach((migration) => {
        logger.log(`  - ${migration.name}`);
      });
    } else {
      logger.log('Banco de dados ja esta atualizado');
    }
    await dataSource.destroy();
  } catch (error) {
    logger.error('Erro ao executar migrations:', error.message);
    process.exit(1);
  }

  // NOTA: Para executar seeds, use manualmente: npm run seed
  // Não executamos automaticamente para evitar duplicações em hot reload

  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
  });

  app.use(cookieParser());

  // Configurar JSON para não escapar caracteres Unicode
  app.getHttpAdapter().getInstance().set('json escape', false);
  app.getHttpAdapter().getInstance().set('json replacer', null);
  app.getHttpAdapter().getInstance().set('json spaces', 2);

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

  const corsOrigins = configService.get<string>('CORS_ORIGINS');
  const allowedOrigins = corsOrigins
    ? corsOrigins.split(',').map((o) => o.trim())
    : [
        'http://localhost:3001',
        'http://127.0.0.1:3001',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
      ];

  app.enableCors({
    origin: (origin, callback) => {
      // Permite requisições sem Origin (curl, healthchecks, server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} não permitida por CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.listen(configService.get<number>('PORT') || 8088);
}
bootstrap();
