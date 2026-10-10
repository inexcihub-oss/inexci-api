import { OpenAPIObject } from '@nestjs/swagger';
import { buildOpenapiDocument } from './generate-openapi';

type SchemaObject = {
  properties?: Record<string, unknown>;
  required?: string[];
};

describe('buildOpenapiDocument', () => {
  let document: OpenAPIObject;

  beforeAll(async () => {
    document = await buildOpenapiDocument();
  }, 180000);

  it('usa a configuração compartilhada do Swagger', () => {
    expect(document.info.title).toBe('Inexci API');
    expect(document.components?.securitySchemes).toHaveProperty('bearer');
  });

  it('inclui as rotas conhecidas', () => {
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/surgery-requests',
        '/hospitals',
        '/hospitals/{id}',
        '/health_plans',
      ]),
    );
  });

  it('descreve as propriedades dos DTOs pelo plugin do swagger', () => {
    const schemas = (document.components?.schemas ?? {}) as Record<
      string,
      SchemaObject
    >;
    const createHospital = schemas.CreateHospitalDto;
    expect(createHospital?.properties).toHaveProperty('name');
    expect(createHospital?.properties).toHaveProperty('cnpj');
    expect(createHospital?.required).toContain('name');
  });

  it('não repete operationId entre controllers', () => {
    const ids = Object.values(document.paths).flatMap((pathItem) =>
      Object.values(pathItem as Record<string, { operationId?: string }>)
        .map((operation) => operation?.operationId)
        .filter((id): id is string => typeof id === 'string'),
    );
    const repetidos = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(repetidos).toEqual([]);
  });

  it('referencia o DTO no corpo da criação de hospital', () => {
    const body = document.paths['/hospitals']?.post?.requestBody as {
      content: Record<string, { schema: { $ref: string } }>;
    };
    expect(body.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/CreateHospitalDto',
    );
  });
});
