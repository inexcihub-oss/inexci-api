import * as fs from 'fs';
import * as path from 'path';
import { envValidationSchema, MARCADOR_VALOR_DE_DEV } from './app.config';

function lerEnvExample(): Record<string, string> {
  const conteudo = fs.readFileSync(
    path.join(__dirname, '..', '..', '.env.example'),
    'utf8',
  );
  const env: Record<string, string> = {};
  for (const linha of conteudo.split('\n')) {
    const texto = linha.trim();
    if (!texto || texto.startsWith('#')) continue;
    const igual = texto.indexOf('=');
    if (igual <= 0) continue;
    env[texto.slice(0, igual)] = texto.slice(igual + 1);
  }
  return env;
}

function validate(env: Record<string, string>) {
  return envValidationSchema.validate(env, {
    allowUnknown: true,
    abortEarly: false,
  });
}

const SEGREDO_DE_PRODUCAO = 'x'.repeat(48);

describe('.env.example da API', () => {
  it('sobe em desenvolvimento só copiando o arquivo', () => {
    const { error } = validate(lerEnvExample());
    expect(error?.message).toBeUndefined();
  });

  it('marca os segredos de exemplo como valor de desenvolvimento', () => {
    const env = lerEnvExample();
    expect(env.JWT_SECRET).toContain(MARCADOR_VALOR_DE_DEV);
    expect(env.PHONE_HASH_SALT).toContain(MARCADOR_VALOR_DE_DEV);
    expect(env.DB_ENCRYPTION_KEY).toBe('');
  });

  it('recusa os segredos de desenvolvimento em produção', () => {
    const { error } = validate({
      ...lerEnvExample(),
      NODE_ENV: 'production',
    });
    expect(error?.message).toContain(
      'JWT_SECRET está com o valor de exemplo de desenvolvimento',
    );
    expect(error?.message).toContain(
      'PHONE_HASH_SALT está com o valor de exemplo de desenvolvimento',
    );
  });

  it('aceita segredos reais em produção', () => {
    const { error } = validate({
      ...lerEnvExample(),
      NODE_ENV: 'production',
      JWT_SECRET: SEGREDO_DE_PRODUCAO,
      PHONE_HASH_SALT: SEGREDO_DE_PRODUCAO,
    });
    expect(error?.message ?? '').not.toMatch(/JWT_SECRET|PHONE_HASH_SALT/);
  });

  it('mantém os segredos de desenvolvimento válidos fora de produção', () => {
    const { error } = validate({
      ...lerEnvExample(),
      NODE_ENV: 'test',
    });
    expect(error?.message).toBeUndefined();
  });
});
