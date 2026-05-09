import * as dayjs from 'dayjs';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { NestFactory, Reflector } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as customParse from 'dayjs/plugin/customParseFormat';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';

dayjs.extend(customParse);

async function bootstrap() {
  // NOTA: As migrations NÃO são executadas automaticamente.
  // Para rodá-las manualmente: npm run migration:run
  // Para executar seeds, use manualmente: npm run seed
  // Não executamos automaticamente para evitar duplicações em hot reload

  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
  });

  app.use(cookieParser());

  app.useWebSocketAdapter(new IoAdapter(app));

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

  // Swagger / OpenAPI
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
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'ngrok-skip-browser-warning',
    ],
  });

  await app.listen(configService.get<number>('PORT') || 3000);
}
bootstrap();
