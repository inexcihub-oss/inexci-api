const PLACEHOLDER_SECRET = 'openapi-placeholder-secret-0000000000000000';

export const OPENAPI_PLACEHOLDER_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'development',
  DASHBOARD_URL: 'http://localhost:3001',
  JWT_SECRET: PLACEHOLDER_SECRET,
  JWT_ISSUER: 'inexci-api',
  JWT_AUDIENCE: 'inexci-app',
  DATABASE_URL: 'postgresql://openapi:openapi@127.0.0.1:1/openapi',
  CORS_ORIGINS: 'http://localhost:3001',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '1',
  R2_ACCOUNT_ID: 'openapi',
  R2_ACCESS_KEY_ID: 'openapi',
  R2_SECRET_ACCESS_KEY: 'openapi',
  R2_BUCKET: 'openapi',
  PHONE_HASH_SALT: PLACEHOLDER_SECRET,
  OTEL_EXPORTER_OTLP_ENDPOINT: '',
  OTEL_METRICS_ENABLED: 'false',
};

export function applyOpenapiPlaceholderEnv(): void {
  Object.assign(process.env, OPENAPI_PLACEHOLDER_ENV);
}
