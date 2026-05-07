import * as Joi from 'joi';

/**
 * Schema de validacao de variaveis de ambiente.
 * O app falha no startup se uma variavel obrigatoria estiver ausente.
 */
export const envValidationSchema = Joi.object({
  // ── Core ─────────────────────────────────────────────
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(8088),
  DASHBOARD_URL: Joi.string().uri().required(),

  // ── Auth ─────────────────────────────────────────────
  JWT_SECRET: Joi.string().required(),

  // ── Database ─────────────────────────────────────────
  DATABASE_URL: Joi.string().required(),

  // ── CORS ─────────────────────────────────────────────
  CORS_ORIGINS: Joi.string().default('http://localhost:3000'),

  // ── Redis ────────────────────────────────────────────
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),

  // ── Supabase ─────────────────────────────────────────
  SUPABASE_URL: Joi.string().allow('').default(''),
  SUPABASE_KEY: Joi.string().allow('').default(''),
  SUPABASE_SERVICE_KEY: Joi.string().allow('').default(''),
  SUPABASE_BUCKET: Joi.string().allow('').default('inexci-storage'),
  SUPABASE_BUCKET_NAME: Joi.string().allow('').default('documents'),

  // ── Email (SMTP) ─────────────────────────────────────
  MAIL_HOST: Joi.string().allow('').default('smtp.example.com'),
  MAIL_PORT: Joi.number().default(587),
  MAIL_SECURE: Joi.string().allow('').default('false'),
  MAIL_USER: Joi.string().allow('').default(''),
  MAIL_PASS: Joi.string().allow('').default(''),
  MAIL_FROM_NAME: Joi.string().allow('').default('Inexci'),
  MAIL_FROM_ADDRESS: Joi.string().allow('').default('noreply@inexci.com.br'),

  // ── Twilio (WhatsApp) ────────────────────────────────
  TWILIO_ACCOUNT_SID: Joi.string().allow('').default(''),
  TWILIO_AUTH_TOKEN: Joi.string().allow('').default(''),
  TWILIO_WHATSAPP_FROM: Joi.string().allow('').default('whatsapp:+14155238886'),

  // ── IA WhatsApp (Áudio/STT) ─────────────────────────
  AI_AUDIO_ENABLED: Joi.string().allow('').default('true'),
  AI_AUDIO_DOWNLOAD_TIMEOUT_MS: Joi.number().default(15000),
  AI_AUDIO_MAX_BYTES: Joi.number().default(15 * 1024 * 1024),
  AI_AUDIO_MAX_DURATION_SECONDS: Joi.number().default(300),
  AI_AUDIO_ALLOWED_MIME: Joi.string()
    .allow('')
    .default('audio/ogg,audio/mpeg,audio/mp4,audio/webm,audio/wav,audio/x-wav'),
  AI_AUDIO_DEBUG_PERSIST: Joi.string().allow('').default('false'),
  AI_AUDIO_DEBUG_DIR: Joi.string().allow('').default('/tmp/inexci-audio-debug'),
  AI_AUDIO_DEBUG_RETENTION_HOURS: Joi.number().default(24),
  AI_TRANSCRIPTION_PROVIDER: Joi.string()
    .valid('faster_whisper', 'openai')
    .default('faster_whisper'),
  AI_TRANSCRIPTION_TIMEOUT_MS: Joi.number().default(30000),
  AI_STT_FASTER_WHISPER_URL: Joi.string()
    .uri()
    .default('http://stt-service:8000'),
  AI_STT_ENABLE_FALLBACK: Joi.string().allow('').default('false'),
  AI_STT_OPENAI_MODEL: Joi.string().allow('').default('whisper-1'),
  AI_STT_OPENAI_URL: Joi.string()
    .uri()
    .default('https://api.openai.com/v1/audio/transcriptions'),

  // ── Puppeteer ────────────────────────────────────────
  PUPPETEER_EXECUTABLE_PATH: Joi.string().allow('').optional(),
}).options({ allowUnknown: true });
