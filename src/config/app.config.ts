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
  SUPABASE_PUBLISHABLE_KEY: Joi.string().allow('').default(''),
  SUPABASE_SECRET_KEY: Joi.string().allow('').default(''),
  SUPABASE_BUCKET: Joi.string().allow('').default('inexci-storage'),

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
  TWILIO_VALIDATE_SIGNATURE: Joi.string().allow('').default('false'),

  // ── Security (criptografia / hash) ───────────────────
  DB_ENCRYPTION_KEY: Joi.string().allow('').default(''),
  PHONE_HASH_SALT: Joi.string().min(32).required(),

  // ── OpenAI / IA conversa ─────────────────────────────
  OPENAI_API_KEY: Joi.string().allow('').default(''),
  OPENAI_MODEL: Joi.string().allow('').default('gpt-4o'),
  OPENAI_EMBEDDING_MODEL: Joi.string()
    .allow('')
    .default('text-embedding-3-small'),
  OPENAI_REQUEST_TIMEOUT_MS: Joi.number().default(25000),
  AI_SESSION_TIMEOUT_MINUTES: Joi.number().default(30),
  AI_MAX_RECENT_MESSAGES: Joi.number().default(6),
  AI_SUMMARY_TRIGGER_EVERY_MESSAGES: Joi.number().default(3),
  AI_SUMMARY_MAX_TOKENS: Joi.number().default(550),
  AI_CONTEXT_TOKEN_BUDGET: Joi.number().default(2600),
  AI_RESPONSE_MAX_TOKENS: Joi.number().default(450),
  AI_PROCESS_TIMEOUT_MS: Joi.number().default(90000),
  AI_CONSENT_PORTAL_URL: Joi.string().allow('').default(''),
  CONVERSATION_CLEANUP_DAYS: Joi.number().default(15),

  // ── Observabilidade / OpenTelemetry ─────────────────
  /** URL do coletor OTLP (Jaeger, Tempo, Grafana Cloud). Omitir = ConsoleExporter em dev, noop em prod. */
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().allow('').optional(),
  /** Fração de traces amostrados (0–1). Default automático: 1.0 em dev, 0.1 em prod. */
  OTEL_TRACES_SAMPLER_ARG: Joi.number().min(0).max(1).optional(),

  // ── RAG ─────────────────────────────────────────────
  /** Número de resultados retornados pelo RAG (default 3). */
  AI_RAG_TOP_K: Joi.number().default(3),
  /** Score mínimo de similaridade coseno para incluir um chunk (default 0.65). */
  AI_RAG_MIN_SCORE: Joi.number().default(0.65),

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

  // ── IA WhatsApp (Documentos / OCR) ──────────────────
  AI_DOC_ENABLED: Joi.string().allow('').default('true'),
  AI_DOC_MAX_BYTES: Joi.number().default(10 * 1024 * 1024),
  AI_DOC_ALLOWED_IMAGE_MIME: Joi.string()
    .allow('')
    .default('image/jpeg,image/jpg,image/png,image/webp'),
  AI_DOC_ALLOWED_PDF_MIME: Joi.string().allow('').default('application/pdf'),
  AI_DOC_MAX_PAGES: Joi.number().default(5),
  AI_DOC_PENDING_TTL_MINUTES: Joi.number().default(10),
  AI_DOC_TMP_FOLDER: Joi.string().allow('').default('whatsapp-tmp'),
  AI_DOC_TMP_RETENTION_HOURS: Joi.number().default(1),
  AI_DOC_OCR_LANG: Joi.string().allow('').default('por'),
  AI_DOC_CLASSIFIER_MODEL: Joi.string().allow('').default('gpt-4o-mini'),
  AI_DOC_VISION_FALLBACK_ENABLED: Joi.string().allow('').default('true'),
  AI_DOC_VISION_FALLBACK_MODEL: Joi.string().allow('').default('gpt-4o'),

  // ── Puppeteer ────────────────────────────────────────
  PUPPETEER_EXECUTABLE_PATH: Joi.string().allow('').optional(),

  // ── Billing / Payment Gateway ────────────────────────
  PAYMENT_GATEWAY_PROVIDER: Joi.string().valid('stripe').default('stripe'),
  STRIPE_SECRET_KEY: Joi.string().allow('').default(''),
  STRIPE_WEBHOOK_SECRET: Joi.string().allow('').default(''),
  STRIPE_REQUEST_TIMEOUT_MS: Joi.number().default(15000),
  BILLING_TRIAL_DAYS: Joi.number().default(30),
  BILLING_GRACE_PERIOD_DAYS: Joi.number().default(7),
  BILLING_TRIAL_REMINDER_DAYS: Joi.string().default('7,3,1'),

  // ── BullBoard ────────────────────────────────────────
  BULL_BOARD_USER: Joi.string().allow('').default(''),
  BULL_BOARD_PASS: Joi.string().allow('').default(''),

  // ── Logging / Observabilidade ────────────────────────
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'log', 'debug', 'verbose')
    .default('log'),
  LOG_PRETTY: Joi.string().allow('').default(''),
  DB_LOG_FULL_QUERIES: Joi.string().allow('').default('false'),
  LOG_RETENTION_NOTIFICATION_DAYS: Joi.number().default(90),
  LOG_RETENTION_AI_USAGE_DAYS: Joi.number().default(365),
  LOG_RETENTION_PII_DAYS: Joi.number().default(180),
  LOG_RETENTION_STALE_DAYS: Joi.number().default(60),
}).options({ allowUnknown: true });
