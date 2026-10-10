import { buildSwaggerConfig, SWAGGER_UI_OPTIONS } from './swagger-config';

describe('buildSwaggerConfig', () => {
  it('monta o documento base da API com autenticação bearer', () => {
    const config = buildSwaggerConfig();

    expect(config.openapi).toMatch(/^3\./);
    expect(config.info).toMatchObject({ title: 'Inexci API', version: '1.0' });
    expect(config.components?.securitySchemes).toHaveProperty('bearer');
  });

  it('mantém as opções da interface do Swagger', () => {
    expect(SWAGGER_UI_OPTIONS.swaggerOptions).toMatchObject({
      persistAuthorization: true,
      docExpansion: 'none',
    });
  });
});
