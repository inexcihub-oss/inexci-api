import { envValidationSchema } from './app.config';

function validate(env: Record<string, string>) {
  return envValidationSchema.validate(env, {
    allowUnknown: true,
    abortEarly: false,
  });
}

describe('TURNSTILE_SECRET_KEY', () => {
  it('é opcional mesmo em produção e assume vazio por padrão', () => {
    const { error, value } = validate({ NODE_ENV: 'production' });
    expect(error?.message ?? '').not.toContain('TURNSTILE_SECRET_KEY');
    expect(value.TURNSTILE_SECRET_KEY).toBe('');
  });

  it('aceita o segredo quando informado', () => {
    const { error, value } = validate({
      NODE_ENV: 'production',
      TURNSTILE_SECRET_KEY: '0x4AAAAAAA',
    });
    expect(error?.message ?? '').not.toContain('TURNSTILE_SECRET_KEY');
    expect(value.TURNSTILE_SECRET_KEY).toBe('0x4AAAAAAA');
  });
});
