import { envValidationSchema } from './app.config';

function validate(env: Record<string, string>) {
  return envValidationSchema.validate(env, {
    allowUnknown: true,
    abortEarly: false,
  });
}

describe('flags de debug em produção', () => {
  it.each(['DB_LOG_FULL_QUERIES', 'AI_AUDIO_DEBUG_PERSIST'])(
    'recusa %s=true quando NODE_ENV=production',
    (flag) => {
      const { error } = validate({ NODE_ENV: 'production', [flag]: 'true' });
      expect(error?.message).toContain(flag);
    },
  );

  it.each(['DB_LOG_FULL_QUERIES', 'AI_AUDIO_DEBUG_PERSIST'])(
    'recusa %s=1 quando NODE_ENV=production',
    (flag) => {
      const { error } = validate({ NODE_ENV: 'production', [flag]: '1' });
      expect(error?.message).toContain(flag);
    },
  );

  it.each(['DB_LOG_FULL_QUERIES', 'AI_AUDIO_DEBUG_PERSIST'])(
    'permite %s=true fora de produção (dev) — a flag não é a causa de erro',
    (flag) => {
      const { error } = validate({ NODE_ENV: 'development', [flag]: 'true' });
      expect(error?.message ?? '').not.toContain(flag);
    },
  );

  it.each(['DB_LOG_FULL_QUERIES', 'AI_AUDIO_DEBUG_PERSIST'])(
    'aceita %s desligada em produção',
    (flag) => {
      const { error } = validate({ NODE_ENV: 'production', [flag]: 'false' });
      expect(error?.message ?? '').not.toContain(flag);
    },
  );
});
