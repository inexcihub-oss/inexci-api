import { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  OpenAPIObject,
  SwaggerCustomOptions,
  SwaggerModule,
} from '@nestjs/swagger';

export const SWAGGER_PATH = 'api/docs';

export const SWAGGER_UI_OPTIONS: SwaggerCustomOptions = {
  swaggerOptions: {
    persistAuthorization: true,
    docExpansion: 'none',
    filter: true,
    tagsSorter: 'alpha',
    operationsSorter: 'alpha',
  },
};

export function buildSwaggerConfig(): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
    .setTitle('Inexci API')
    .setDescription(
      'Documentação completa da API Inexci — gestão de solicitações cirúrgicas',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
}

export function createSwaggerDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(app, buildSwaggerConfig());
}

export function setupSwagger(app: INestApplication): OpenAPIObject {
  const document = createSwaggerDocument(app);
  SwaggerModule.setup(SWAGGER_PATH, app, document, SWAGGER_UI_OPTIONS);
  return document;
}
