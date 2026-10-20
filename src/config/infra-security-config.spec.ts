import { envValidationSchema } from './app.config';

function validate(env: Record<string, string>) {
  return envValidationSchema.validate(env, {
    allowUnknown: true,
    abortEarly: false,
  });
}

describe('variáveis de hardening de infraestrutura', () => {
  it('mantém o TLS do Postgres desligado e a validação ligada por padrão', () => {
    const { error, value } = validate({});
    expect(error?.message ?? '').not.toMatch(/DB_SSL/);
    expect(value.DB_SSL).toBe('false');
    expect(value.DB_SSL_REJECT_UNAUTHORIZED).toBe('true');
    expect(value.DB_SSL_CA).toBe('');
  });

  it('recusa valores de DB_SSL fora de true/false', () => {
    const { error } = validate({ DB_SSL: 'require' });
    expect(error?.message ?? '').toContain('DB_SSL');
  });

  it('aceita o token compartilhado do STT e assume vazio por padrão', () => {
    expect(validate({}).value.AI_STT_SHARED_TOKEN).toBe('');
    const { error, value } = validate({ AI_STT_SHARED_TOKEN: 'abc' });
    expect(error?.message ?? '').not.toContain('AI_STT_SHARED_TOKEN');
    expect(value.AI_STT_SHARED_TOKEN).toBe('abc');
  });
});
